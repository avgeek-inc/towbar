import { randomUUID } from "node:crypto";

import { and, desc, eq, isNull, ne, notInArray } from "drizzle-orm";

import {
  createPreviewAppSnapshot,
  digestValue,
  isNormalizedResource,
  previewHostname,
  previewRef,
  previewRuntimeId,
} from "@workspace/towbar-core";
import {
  deploymentWorkflowId,
  previewBranchEventSchema,
} from "@workspace/towbar-core/temporal";
import {
  apps,
  deployments,
  githubInstallations,
  previewEnvironments,
  releases,
  servers,
  sources,
} from "@workspace/towbar-database/schema";

import { getTowbarDatabase } from "../../infrastructure/database.js";
import { enqueueDeployment } from "../../infrastructure/temporal.js";
import { fetchGitHubRepositoryTree } from "../github/client.js";
import {
  propagatePreviewDeploymentState,
  publishPreviewDeploymentStatus,
} from "../deployments/preview-status.js";
import { calculateReleaseDeploymentDigest } from "../sources/deployment-digests.js";
import { shouldDeferPreviewAdmission } from "./admission-state.js";
import { requestPreviewBranchCleanup } from "./cleanup.js";

import type { PreviewBranchEvent } from "@workspace/towbar-core/temporal";
import type { NormalizedApp } from "@workspace/towbar-core";

const terminalStates = [
  "cancelled",
  "failed",
  "skipped",
  "succeeded",
  "succeeded_with_warnings",
] satisfies Array<(typeof deployments.$inferSelect)["state"]>;

export async function listPreviewEnvironments(input: {
  appId?: string;
  sourceId?: string;
  workspaceId: string;
}) {
  return await getTowbarDatabase()
    .select({
      appId: previewEnvironments.appId,
      appName: apps.name,
      branch: previewEnvironments.branch,
      createdAt: previewEnvironments.createdAt,
      errorMessage: previewEnvironments.errorMessage,
      expiresAt: previewEnvironments.expiresAt,
      gitRef: previewEnvironments.gitRef,
      hostname: previewEnvironments.hostname,
      id: previewEnvironments.id,
      latestCommitSha: previewEnvironments.latestCommitSha,
      latestDeploymentId: previewEnvironments.latestDeploymentId,
      sourceId: previewEnvironments.sourceId,
      status: previewEnvironments.status,
      updatedAt: previewEnvironments.updatedAt,
    })
    .from(previewEnvironments)
    .innerJoin(apps, eq(apps.id, previewEnvironments.appId))
    .where(
      and(
        eq(previewEnvironments.workspaceId, input.workspaceId),
        input.appId ? eq(previewEnvironments.appId, input.appId) : undefined,
        input.sourceId
          ? eq(previewEnvironments.sourceId, input.sourceId)
          : undefined,
        ne(previewEnvironments.status, "deleted"),
      ),
    )
    .orderBy(desc(previewEnvironments.updatedAt));
}

export async function processPreviewBranchEvent(raw: PreviewBranchEvent) {
  const event = previewBranchEventSchema.parse(raw);
  const database = getTowbarDatabase();
  const [source] = await database
    .select({
      branch: sources.branch,
      installationId: githubInstallations.installationId,
      latestManifestDigest: sources.latestManifestDigest,
      repositoryName: sources.repositoryName,
      repositoryOwner: sources.repositoryOwner,
      status: sources.status,
      workspaceId: sources.workspaceId,
    })
    .from(sources)
    .innerJoin(
      githubInstallations,
      eq(githubInstallations.id, sources.githubInstallationId),
    )
    .where(eq(sources.id, event.sourceId))
    .limit(1);
  if (!source || source.status !== "active" || event.branch === source.branch) {
    return { cleanupIds: [], deploymentIds: [], retry: false };
  }
  if (event.deleted) {
    return {
      ...(await requestPreviewBranchCleanup(event.sourceId, event.branch)),
      retry: false,
    };
  }
  if (!event.commitSha || !source.latestManifestDigest) {
    return { cleanupIds: [], deploymentIds: [], retry: false };
  }

  const candidates = await database
    .select({
      appId: apps.id,
      config: apps.config,
      manifestId: apps.manifestId,
      server: servers.config,
      serverConfigDigest: servers.configDigest,
      serverId: servers.id,
      serverPreparedAt: servers.preparedAt,
      serverPreparedConfigDigest: servers.preparedConfigDigest,
    })
    .from(apps)
    .innerJoin(servers, eq(servers.id, apps.serverId))
    .where(
      and(
        eq(apps.sourceId, event.sourceId),
        eq(apps.workspaceId, source.workspaceId),
        eq(apps.kind, "app"),
        isNull(apps.archivedAt),
      ),
    );
  const eligible = candidates.filter(
    (candidate): candidate is typeof candidate & { config: NormalizedApp } =>
      !isNormalizedResource(candidate.config) &&
      candidate.config.preview?.enabled === true &&
      Boolean(candidate.serverPreparedAt) &&
      candidate.serverPreparedConfigDigest === candidate.serverConfigDigest,
  );
  if (eligible.length === 0) {
    return { cleanupIds: [], deploymentIds: [], retry: false };
  }
  const repositoryTree = eligible.some(
    (candidate) => candidate.config.deploymentInputs.length > 0,
  )
    ? await fetchGitHubRepositoryTree({
        commitSha: event.commitSha,
        installationId: source.installationId,
        repositoryName: source.repositoryName,
        repositoryOwner: source.repositoryOwner,
      })
    : undefined;

  const admissions = [];
  for (const candidate of eligible) {
    const hostname = previewHostname({
      appId: candidate.manifestId,
      branch: event.branch,
      domain: candidate.config.preview!.domain,
    });
    const snapshot = createPreviewAppSnapshot(candidate.config, {
      branch: event.branch,
      hostname,
    });
    const digests = calculateReleaseDeploymentDigest({
      commitSha: event.commitSha,
      deployable: snapshot,
      deploymentInputs: candidate.config.deploymentInputs,
      repositoryTree,
      server: candidate.server,
    });
    const admission = await admitPreviewDeployment({
      appId: candidate.appId,
      branch: event.branch,
      commitSha: event.commitSha,
      config: snapshot,
      deploymentDigest: digests.deploymentDigest,
      hostname,
      manifestDigest: source.latestManifestDigest,
      server: candidate.server,
      serverId: candidate.serverId,
      sourceId: event.sourceId,
      sourceInputDigest: digests.sourceInputDigest,
      ttlHours: candidate.config.preview!.ttlHours,
      workspaceId: source.workspaceId,
    });
    admissions.push(admission);
    await Promise.all(
      admission.supersededDeploymentIds.map((deploymentId) =>
        propagatePreviewDeploymentState(deploymentId, "skipped"),
      ),
    );
    if (admission.deploymentId && admission.created) {
      await publishPreviewDeploymentStatus(
        admission.deploymentId,
        "queued",
      ).catch(() => undefined);
      try {
        await enqueueDeployment({
          appId: candidate.appId,
          buildConcurrency: candidate.server.buildConcurrency ?? 1,
          deploymentId: admission.deploymentId,
          previewBuildConcurrency:
            candidate.server.previewBuildConcurrency ?? 1,
          priority: "preview",
          serverIp: candidate.server.ip,
        });
      } catch (error) {
        await markPreviewAdmissionFailed(admission.deploymentId, error);
        throw error;
      }
    }
  }
  return {
    cleanupIds: [],
    deploymentIds: admissions
      .map((admission) => admission.deploymentId)
      .filter((id): id is string => Boolean(id)),
    retry: admissions.some((admission) => admission.deferred),
  };
}

async function admitPreviewDeployment(input: {
  appId: string;
  branch: string;
  commitSha: string;
  config: NormalizedApp;
  deploymentDigest: string;
  hostname: string;
  manifestDigest: string;
  server: (typeof servers.$inferSelect)["config"];
  serverId: string;
  sourceId: string;
  sourceInputDigest: string | null;
  ttlHours: number;
  workspaceId: string;
}) {
  const database = getTowbarDatabase();
  const gitRef = previewRef(input.branch);
  const runtimeId = previewRuntimeId(input.config.id, input.branch);
  const deploymentId = randomUUID();
  const expiresAt = new Date(Date.now() + input.ttlHours * 60 * 60_000);
  const admission = await database.transaction(async (transaction) => {
    const [existingEnvironment] = await transaction
      .select({
        id: previewEnvironments.id,
        status: previewEnvironments.status,
      })
      .from(previewEnvironments)
      .where(
        and(
          eq(previewEnvironments.sourceId, input.sourceId),
          eq(previewEnvironments.appId, input.appId),
          eq(previewEnvironments.gitRef, gitRef),
        ),
      )
      .for("update")
      .limit(1);
    if (
      existingEnvironment &&
      shouldDeferPreviewAdmission(existingEnvironment.status)
    ) {
      return {
        created: false,
        deferred: true,
        deploymentId: null,
        environmentId: existingEnvironment.id,
        supersededDeploymentIds: [],
      };
    }
    const [environment] = await transaction
      .insert(previewEnvironments)
      .values({
        appId: input.appId,
        branch: input.branch,
        expiresAt,
        gitRef,
        hostname: input.hostname,
        latestCommitSha: input.commitSha,
        runtimeId,
        serverId: input.serverId,
        sourceId: input.sourceId,
        workspaceId: input.workspaceId,
      })
      .onConflictDoUpdate({
        target: [
          previewEnvironments.sourceId,
          previewEnvironments.appId,
          previewEnvironments.gitRef,
        ],
        set: {
          branch: input.branch,
          deletedAt: null,
          errorMessage: null,
          expiresAt,
          hostname: input.hostname,
          latestCommitSha: input.commitSha,
          runtimeId,
          serverId: input.serverId,
          status: "building",
          updatedAt: new Date(),
        },
      })
      .returning();
    if (!environment)
      throw new Error("Unable to materialize Preview environment");

    const [current] = await transaction
      .select({
        commitSha: releases.commitSha,
        deploymentDigest: releases.deploymentDigest,
      })
      .from(releases)
      .where(
        and(
          eq(releases.previewEnvironmentId, environment.id),
          eq(releases.status, "current"),
        ),
      )
      .limit(1);
    if (
      current?.commitSha === input.commitSha &&
      current.deploymentDigest === input.deploymentDigest
    ) {
      await transaction
        .update(previewEnvironments)
        .set({ status: "healthy", updatedAt: new Date() })
        .where(eq(previewEnvironments.id, environment.id));
      return {
        created: false,
        deferred: false,
        deploymentId: null,
        environmentId: environment.id,
        supersededDeploymentIds: [],
      };
    }

    const [active] = await transaction
      .select({ id: deployments.id })
      .from(deployments)
      .where(
        and(
          eq(deployments.previewEnvironmentId, environment.id),
          eq(deployments.commitSha, input.commitSha),
          eq(deployments.deploymentDigest, input.deploymentDigest),
          notInArray(deployments.state, terminalStates),
        ),
      )
      .orderBy(desc(deployments.createdAt))
      .limit(1);
    if (active) {
      return {
        created: false,
        deferred: false,
        deploymentId: active.id,
        environmentId: environment.id,
        supersededDeploymentIds: [],
      };
    }

    const now = new Date();
    const supersededDeployments = await transaction
      .update(deployments)
      .set({
        errorCode: "PREVIEW_SUPERSEDED",
        errorMessage: "Superseded by a newer Preview commit",
        finishedAt: now,
        state: "skipped",
        updatedAt: now,
      })
      .where(
        and(
          eq(deployments.previewEnvironmentId, environment.id),
          eq(deployments.state, "queued"),
        ),
      )
      .returning({ id: deployments.id });
    await transaction.insert(deployments).values({
      appId: input.appId,
      appSnapshot: input.config,
      commitSha: input.commitSha,
      configDigest: digestValue(input.config),
      deployableKind: "app",
      deploymentDigest: input.deploymentDigest,
      environment: "preview",
      gitRef,
      hostname: input.hostname,
      id: deploymentId,
      idempotencyKey: `preview:${environment.id}:${input.commitSha}:${input.deploymentDigest}`,
      manifestDigest: input.manifestDigest,
      previewEnvironmentId: environment.id,
      requestedBy: null,
      serverId: input.serverId,
      serverSnapshot: input.server,
      sourceId: input.sourceId,
      sourceInputDigest: input.sourceInputDigest,
      temporalWorkflowId: deploymentWorkflowId(deploymentId),
      workspaceId: input.workspaceId,
    });
    await transaction
      .update(previewEnvironments)
      .set({ latestDeploymentId: deploymentId, updatedAt: now })
      .where(eq(previewEnvironments.id, environment.id));
    return {
      created: true,
      deferred: false,
      deploymentId,
      environmentId: environment.id,
      supersededDeploymentIds: supersededDeployments.map(
        (deployment) => deployment.id,
      ),
    };
  });
  return admission;
}

async function markPreviewAdmissionFailed(
  deploymentId: string,
  error: unknown,
) {
  const message =
    error instanceof Error
      ? error.message.slice(0, 1_000)
      : "Preview deployment queue is unavailable";
  const now = new Date();
  await getTowbarDatabase()
    .update(deployments)
    .set({
      errorCode: "TEMPORAL_UNAVAILABLE",
      errorMessage: message,
      finishedAt: now,
      state: "failed",
      updatedAt: now,
    })
    .where(eq(deployments.id, deploymentId));
  await propagatePreviewDeploymentState(deploymentId, "failed");
}
