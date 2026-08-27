import { and, eq, inArray, isNull, lt } from "drizzle-orm";

import { isNormalizedResource, previewRef } from "@workspace/towbar-core";
import {
  apps,
  deployments,
  previewEnvironments,
  releases,
  servers,
  sshHostKeys,
} from "@workspace/towbar-database/schema";

import { getTowbarDatabase } from "../../infrastructure/database.js";
import { enqueuePreviewCleanup } from "../../infrastructure/temporal.js";
import {
  resolveDeploymentCloudflareSecret,
  resolveDeploymentLogin,
} from "../deployments/service.js";
import {
  propagatePreviewDeploymentState,
  publishPreviewDeploymentStatus,
} from "../deployments/preview-status.js";
import {
  enqueueClaimedPreviewCleanups,
  previewCleanupAdmissionFailureMessage,
} from "./cleanup-admission.js";

const cleanablePreviewStatuses = [
  "building",
  "healthy",
  "failed",
  "cleanup_failed",
] satisfies Array<(typeof previewEnvironments.$inferSelect)["status"]>;

export async function requestPreviewBranchCleanup(
  sourceId: string,
  branch: string,
) {
  const gitRef = previewRef(branch);
  const environments = await getTowbarDatabase()
    .update(previewEnvironments)
    .set({ status: "deleting", updatedAt: new Date() })
    .where(
      and(
        eq(previewEnvironments.sourceId, sourceId),
        eq(previewEnvironments.gitRef, gitRef),
        inArray(previewEnvironments.status, cleanablePreviewStatuses),
      ),
    )
    .returning({
      appId: previewEnvironments.appId,
      id: previewEnvironments.id,
      serverId: previewEnvironments.serverId,
    });
  await queuePreviewCleanup(environments, "The Git branch was deleted");
  return {
    cleanupIds: environments.map((environment) => environment.id),
    deploymentIds: [],
  };
}

export async function requestPreviewEnvironmentCleanup(input: {
  previewEnvironmentId: string;
  reason?: string;
  workspaceId: string;
}) {
  const environments = await getTowbarDatabase()
    .update(previewEnvironments)
    .set({ status: "deleting", updatedAt: new Date() })
    .where(
      and(
        eq(previewEnvironments.id, input.previewEnvironmentId),
        eq(previewEnvironments.workspaceId, input.workspaceId),
        inArray(previewEnvironments.status, cleanablePreviewStatuses),
      ),
    )
    .returning({
      appId: previewEnvironments.appId,
      id: previewEnvironments.id,
      serverId: previewEnvironments.serverId,
    });
  await queuePreviewCleanup(
    environments,
    input.reason ?? "Preview cleanup was requested",
  );
  return { accepted: environments.length > 0 };
}

export async function requestExpiredPreviewCleanups(now = new Date()) {
  const environments = await getTowbarDatabase()
    .update(previewEnvironments)
    .set({ status: "deleting", updatedAt: now })
    .where(
      and(
        lt(previewEnvironments.expiresAt, now),
        inArray(previewEnvironments.status, cleanablePreviewStatuses),
      ),
    )
    .returning({
      appId: previewEnvironments.appId,
      id: previewEnvironments.id,
      serverId: previewEnvironments.serverId,
    });
  await queuePreviewCleanup(environments, "The Preview deployment expired");
  return environments.length;
}

export async function requestDisabledPreviewCleanups(sourceId: string) {
  const activeEnvironments = await getTowbarDatabase()
    .select({
      appId: previewEnvironments.appId,
      archivedAt: apps.archivedAt,
      config: apps.config,
      id: previewEnvironments.id,
      serverId: previewEnvironments.serverId,
    })
    .from(previewEnvironments)
    .innerJoin(apps, eq(apps.id, previewEnvironments.appId))
    .where(
      and(
        eq(previewEnvironments.sourceId, sourceId),
        inArray(previewEnvironments.status, cleanablePreviewStatuses),
      ),
    );
  const cleanups = [];
  for (const environment of activeEnvironments) {
    if (
      !isNormalizedResource(environment.config) &&
      !environment.archivedAt &&
      environment.config.preview?.enabled === true
    ) {
      continue;
    }
    const [claimed] = await getTowbarDatabase()
      .update(previewEnvironments)
      .set({ status: "deleting", updatedAt: new Date() })
      .where(
        and(
          eq(previewEnvironments.id, environment.id),
          inArray(previewEnvironments.status, cleanablePreviewStatuses),
        ),
      )
      .returning({
        appId: previewEnvironments.appId,
        id: previewEnvironments.id,
        serverId: previewEnvironments.serverId,
      });
    if (claimed) cleanups.push(claimed);
  }
  await queuePreviewCleanup(cleanups, "Preview deployments were disabled");
  return cleanups.length;
}

async function queuePreviewCleanup(
  environments: Array<{ appId: string; id: string; serverId: string }>,
  reason: string,
) {
  if (environments.length > 0) {
    const ids = environments.map((environment) => environment.id);
    const now = new Date();
    const skippedDeployments = await getTowbarDatabase()
      .update(deployments)
      .set({
        errorCode: "PREVIEW_DELETED",
        errorMessage: reason,
        finishedAt: now,
        state: "skipped",
        updatedAt: now,
      })
      .where(
        and(
          inArray(deployments.previewEnvironmentId, ids),
          eq(deployments.state, "queued"),
        ),
      )
      .returning({ id: deployments.id });
    await Promise.all(
      skippedDeployments.map((deployment) =>
        propagatePreviewDeploymentState(deployment.id, "skipped"),
      ),
    );
  }
  const serverRows = environments.length
    ? await getTowbarDatabase()
        .select({
          config: servers.config,
          id: servers.id,
          ip: servers.canonicalIp,
        })
        .from(servers)
        .where(
          inArray(
            servers.id,
            environments.map((environment) => environment.serverId),
          ),
        )
    : [];
  const serverById = new Map(
    serverRows.map((server) => [
      server.id,
      {
        buildConcurrency: server.config.buildConcurrency ?? 1,
        ip: server.ip,
        previewBuildConcurrency: server.config.previewBuildConcurrency ?? 1,
      },
    ]),
  );
  await enqueueClaimedPreviewCleanups({
    enqueue: async (environment, server) => {
      await enqueuePreviewCleanup({
        appId: environment.appId,
        buildConcurrency: server.buildConcurrency,
        previewBuildConcurrency: server.previewBuildConcurrency,
        previewEnvironmentId: environment.id,
        serverIp: server.ip,
      });
    },
    environments,
    markFailed: markPreviewCleanupAdmissionFailed,
    serverById,
  });
}

async function markPreviewCleanupAdmissionFailed(
  environment: { id: string },
  error: unknown,
) {
  await getTowbarDatabase()
    .update(previewEnvironments)
    .set({
      errorMessage: previewCleanupAdmissionFailureMessage(error),
      status: "cleanup_failed",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(previewEnvironments.id, environment.id),
        eq(previewEnvironments.status, "deleting"),
      ),
    );
}

export async function getPreviewCleanupContext(previewEnvironmentId: string) {
  const [environment] = await getTowbarDatabase()
    .select({
      hostname: previewEnvironments.hostname,
      id: previewEnvironments.id,
      latestDeploymentId: previewEnvironments.latestDeploymentId,
      runtimeId: previewEnvironments.runtimeId,
      server: servers.config,
      serverId: servers.id,
    })
    .from(previewEnvironments)
    .innerJoin(servers, eq(servers.id, previewEnvironments.serverId))
    .where(eq(previewEnvironments.id, previewEnvironmentId))
    .limit(1);
  if (!environment) throw new Error("Preview environment was not found");
  const [releaseRows, trustedHostKeys] = await Promise.all([
    getTowbarDatabase()
      .select({
        containerName: releases.containerName,
        imageTag: releases.imageTag,
      })
      .from(releases)
      .where(
        and(
          eq(releases.previewEnvironmentId, previewEnvironmentId),
          inArray(releases.status, ["current", "previous"]),
        ),
      ),
    getTowbarDatabase()
      .select({
        algorithm: sshHostKeys.algorithm,
        fingerprint: sshHostKeys.fingerprint,
        publicKey: sshHostKeys.publicKey,
      })
      .from(sshHostKeys)
      .where(
        and(
          eq(sshHostKeys.serverId, environment.serverId),
          isNull(sshHostKeys.revokedAt),
        ),
      ),
  ]);
  return {
    context: {
      containerNames: releaseRows.map((release) => release.containerName),
      hostname: environment.hostname,
      imageTags: releaseRows.map((release) => release.imageTag),
      previewEnvironmentId: environment.id,
      runtimeId: environment.runtimeId,
      server: environment.server,
      trustedHostKeys,
    },
    latestDeploymentId: environment.latestDeploymentId,
  };
}

export async function resolvePreviewCleanupSecrets(
  previewEnvironmentId: string,
) {
  const cleanup = await getPreviewCleanupContext(previewEnvironmentId);
  if (!cleanup.latestDeploymentId) {
    throw new Error("Preview environment has no deployment snapshot");
  }
  const [login, cloudflare] = await Promise.all([
    resolveDeploymentLogin(cleanup.latestDeploymentId),
    resolveDeploymentCloudflareSecret(cleanup.latestDeploymentId),
  ]);
  return { cloudflare, login };
}

export async function recordPreviewCleanupResult(
  previewEnvironmentId: string,
  input: { errorMessage?: string; succeeded: boolean },
) {
  const now = new Date();
  const [environment] = await getTowbarDatabase()
    .select({ latestDeploymentId: previewEnvironments.latestDeploymentId })
    .from(previewEnvironments)
    .where(eq(previewEnvironments.id, previewEnvironmentId))
    .limit(1);
  await getTowbarDatabase().transaction(async (transaction) => {
    await transaction
      .update(previewEnvironments)
      .set({
        deletedAt: input.succeeded ? now : null,
        errorMessage: input.errorMessage?.slice(0, 1_000) ?? null,
        status: input.succeeded ? "deleted" : "cleanup_failed",
        updatedAt: now,
      })
      .where(eq(previewEnvironments.id, previewEnvironmentId));
    if (input.succeeded) {
      await transaction
        .update(releases)
        .set({ status: "superseded", supersededAt: now })
        .where(eq(releases.previewEnvironmentId, previewEnvironmentId));
    }
  });
  if (input.succeeded && environment?.latestDeploymentId) {
    await publishPreviewDeploymentStatus(
      environment.latestDeploymentId,
      "inactive",
    ).catch(() => undefined);
  }
  return { accepted: true };
}
