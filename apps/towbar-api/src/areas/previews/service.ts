import { and, desc, eq, isNull, ne } from "drizzle-orm";

import {
  createPreviewAppSnapshot,
  isNormalizedResource,
  previewHostname,
  resolveRepositoryEnvironment,
  shouldDeployForChangedPaths,
} from "@workspace/towbar-core";
import { previewPullRequestEventSchema } from "@workspace/towbar-core/temporal";
import {
  apps,
  githubInstallations,
  previewEnvironments,
  servers,
  sourceEnvironments,
  sourceSyncs,
  sources,
} from "@workspace/towbar-database/schema";

import { fetchGitHubEnvironmentSnapshot } from "../github/environment-snapshot.js";
import { withPreviewLifecycleLock } from "./lifecycle-lock.js";
import { samePreviewPullRequestRevision } from "./pull-request.js";
import { selectObsoletePreviewApps } from "./cleanup-selection.js";
import { resolvePreviewConfiguration } from "./configuration.js";
import { assertRequiredInstanceSecrets } from "../apps/secrets.js";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import { enqueueDeployment } from "../../infrastructure/temporal.js";
import {
  fetchGitHubPullRequest,
  fetchGitHubPullRequestChangedPaths,
  fetchGitHubRepositoryTree,
} from "../github/client.js";
import {
  propagatePreviewDeploymentState,
  publishPreviewDeploymentStatus,
} from "../deployments/preview-status.js";
import {
  emitDeploymentNotification,
  emitPreviewNotification,
} from "../notifications/events.js";
import { calculateReleaseDeploymentDigest } from "../sources/deployment-digests.js";
import { admitPreviewDeployment } from "./admission.js";
import {
  requestObsoletePreviewCleanups,
  requestPreviewPullRequestCleanup,
} from "./cleanup.js";
import { previewPullRequestDisposition } from "./pull-request.js";
import { publishPreviewPullRequestComment } from "./pr-comment.js";
import {
  closePreviewPullRequestReport,
  recordPreviewPullRequestPlan,
} from "./reporting-state.js";

import type { PreviewPullRequestEvent } from "@workspace/towbar-core/temporal";
import type { NormalizedApp } from "@workspace/towbar-core";

export { scheduleSourcePreviewReconciliations } from "./reconciliation-scheduler.js";

export async function listPreviewEnvironments(input: {
  appId?: string;
  sourceId?: string;
  workspaceId: string;
}) {
  const rows = await getTowbarDatabase()
    .select({
      appId: previewEnvironments.appId,
      appName: apps.name,
      branch: previewEnvironments.branch,
      cleanupAttempts: previewEnvironments.cleanupAttempts,
      createdAt: previewEnvironments.createdAt,
      errorMessage: previewEnvironments.errorMessage,
      expiresAt: previewEnvironments.expiresAt,
      gitRef: previewEnvironments.gitRef,
      hostname: previewEnvironments.hostname,
      id: previewEnvironments.id,
      latestCommitSha: previewEnvironments.latestCommitSha,
      latestDeploymentId: previewEnvironments.latestDeploymentId,
      nextCleanupAttemptAt: previewEnvironments.nextCleanupAttemptAt,
      pullRequestNumber: previewEnvironments.pullRequestNumber,
      repositoryName: sources.repositoryName,
      repositoryOwner: sources.repositoryOwner,
      sourceId: previewEnvironments.sourceId,
      status: previewEnvironments.status,
      updatedAt: previewEnvironments.updatedAt,
    })
    .from(previewEnvironments)
    .innerJoin(apps, eq(apps.id, previewEnvironments.appId))
    .innerJoin(sources, eq(sources.id, previewEnvironments.sourceId))
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
  return rows.map(({ repositoryName, repositoryOwner, ...preview }) => ({
    ...preview,
    pullRequestUrl: `https://github.com/${repositoryOwner}/${repositoryName}/pull/${preview.pullRequestNumber}`,
  }));
}

export async function processPreviewPullRequestEvent(
  raw: PreviewPullRequestEvent,
) {
  const event = previewPullRequestEventSchema.parse(raw);
  return withPreviewLifecycleLock(event, () =>
    reconcilePreviewPullRequest(event),
  );
}

async function reconcilePreviewPullRequest(event: PreviewPullRequestEvent) {
  const database = getTowbarDatabase();
  const [source] = await database
    .select({
      installationId: githubInstallations.installationId,
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
  if (!source || source.status !== "active") {
    return { cleanupIds: [], deploymentIds: [], retry: false };
  }
  const pullRequest = await fetchGitHubPullRequest({
    installationId: source.installationId,
    pullRequestNumber: event.pullRequestNumber,
    repositoryName: source.repositoryName,
    repositoryOwner: source.repositoryOwner,
  });
  const environments = await database
    .select()
    .from(sourceEnvironments)
    .where(
      and(
        eq(sourceEnvironments.sourceId, event.sourceId),
        eq(sourceEnvironments.branch, pullRequest.baseBranch),
        eq(sourceEnvironments.previewsEnabled, true),
        isNull(sourceEnvironments.disconnectedAt),
      ),
    );
  const disposition = previewPullRequestDisposition({
    pullRequest,
    repositoryName: source.repositoryName,
    repositoryOwner: source.repositoryOwner,
    sourceBranches: environments.map((environment) => environment.branch),
  });
  if (disposition.action === "cleanup") {
    await closePreviewPullRequestReport({
      pullRequestNumber: event.pullRequestNumber,
      sourceId: event.sourceId,
    });
    return {
      ...(await requestPreviewPullRequestCleanup({
        pullRequestNumber: event.pullRequestNumber,
        reason: disposition.reason,
        sourceId: event.sourceId,
      })),
      retry: false,
    };
  }
  const changedPaths = await fetchGitHubPullRequestChangedPaths({
    changedFileCount: pullRequest.changedFileCount,
    installationId: source.installationId,
    pullRequestNumber: pullRequest.number,
    repositoryName: source.repositoryName,
    repositoryOwner: source.repositoryOwner,
  });

  const candidates = await database
    .select({
      appId: apps.id,
      environmentId: sourceEnvironments.id,
      targetConfigDigest: apps.configDigest,
      targetEnvironment: sourceEnvironments,
      manifestDigest: sourceEnvironments.latestManifestDigest,
      appName: apps.name,
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
    .innerJoin(
      sourceEnvironments,
      eq(sourceEnvironments.id, apps.sourceEnvironmentId),
    )
    .innerJoin(
      sourceSyncs,
      eq(sourceSyncs.id, sourceEnvironments.latestSuccessfulSyncId),
    )
    .where(
      and(
        eq(apps.sourceId, event.sourceId),
        eq(apps.workspaceId, source.workspaceId),
        eq(apps.kind, "app"),
        eq(sourceEnvironments.branch, pullRequest.baseBranch),
        eq(sourceEnvironments.previewsEnabled, true),
        isNull(sourceEnvironments.disconnectedAt),
        eq(sourceEnvironments.mappingRevision, sourceSyncs.mappingRevision),
        isNull(apps.archivedAt),
      ),
    );
  const targets = candidates.filter(
    (candidate): candidate is typeof candidate & { config: NormalizedApp } =>
      Boolean(candidate.manifestDigest) &&
      !isNormalizedResource(candidate.config) &&
      candidate.config.preview?.enabled === true &&
      Boolean(candidate.serverPreparedAt) &&
      candidate.serverPreparedConfigDigest === candidate.serverConfigDigest,
  );
  const repositorySnapshot = await fetchGitHubEnvironmentSnapshot({
    installationId: source.installationId,
    repositoryName: source.repositoryName,
    repositoryOwner: source.repositoryOwner,
    commitSha: pullRequest.headSha,
  });
  const resolved = new Map(
    environments.map((environment) => [
      environment.id,
      resolveRepositoryEnvironment({
        ...repositorySnapshot,
        environment: environment.name,
        branch: environment.branch,
      }),
    ]),
  );
  const eligible = targets.flatMap((target) => {
    const configuration = resolvePreviewConfiguration({
      resolved: resolved.get(target.environmentId)!,
      target: target.config,
    });
    return configuration ? [{ ...target, ...configuration }] : [];
  });
  const relevant = eligible.filter((candidate) =>
    shouldDeployForChangedPaths({
      changedPaths,
      deploymentInputs: candidate.config.deploymentInputs,
    }),
  );
  const relevantAppIds = new Set(relevant.map((candidate) => candidate.appId));
  const latestPullRequest = await fetchGitHubPullRequest({
    installationId: source.installationId,
    pullRequestNumber: event.pullRequestNumber,
    repositoryName: source.repositoryName,
    repositoryOwner: source.repositoryOwner,
  });
  if (!samePreviewPullRequestRevision(pullRequest, latestPullRequest)) {
    return { cleanupIds: [], deploymentIds: [], retry: true };
  }
  await recordPreviewPullRequestPlan({
    branch: pullRequest.headBranch,
    hasDeployments: relevant.length > 0,
    latestCommitSha: pullRequest.headSha,
    pullRequestNumber: pullRequest.number,
    skippedApps: eligible
      .filter((candidate) => !relevantAppIds.has(candidate.appId))
      .map((candidate) => ({
        appId: candidate.appId,
        appName: candidate.appName,
        reason: "no matching changes",
      })),
    sourceId: event.sourceId,
    workspaceId: source.workspaceId,
  });
  const existing = await database
    .select({
      appId: apps.id,
      environmentId: apps.sourceEnvironmentId,
      archivedAt: apps.archivedAt,
      config: apps.config,
    })
    .from(previewEnvironments)
    .innerJoin(apps, eq(apps.id, previewEnvironments.appId))
    .where(
      and(
        eq(previewEnvironments.sourceId, event.sourceId),
        eq(previewEnvironments.pullRequestNumber, pullRequest.number),
        ne(previewEnvironments.status, "deleted"),
      ),
    );
  const cleanup = await requestObsoletePreviewCleanups({
    appIds: selectObsoletePreviewApps({
      existing: existing.map((app) => ({
        appId: app.appId,
        environmentId: app.environmentId,
        archived: Boolean(app.archivedAt),
        enabled:
          !isNormalizedResource(app.config) &&
          Boolean(app.config.preview?.enabled),
      })),
      targetEnvironmentIds: environments.map((environment) => environment.id),
      evaluatedAppIds: targets.map((target) => target.appId),
      relevantAppIds: [...relevantAppIds],
    }),
    pullRequestNumber: pullRequest.number,
    sourceId: event.sourceId,
  });
  if (relevant.length === 0) {
    await publishPreviewPullRequestComment({
      pullRequestNumber: pullRequest.number,
      sourceId: event.sourceId,
    }).catch(() => undefined);
    return { ...cleanup, deploymentIds: [], retry: false };
  }
  const repositoryTree = relevant.some(
    (candidate) => candidate.config.deploymentInputs.length > 0,
  )
    ? await fetchGitHubRepositoryTree({
        commitSha: pullRequest.headSha,
        installationId: source.installationId,
        repositoryName: source.repositoryName,
        repositoryOwner: source.repositoryOwner,
      })
    : undefined;

  const admissions = [];
  for (const candidate of relevant) {
    await assertRequiredInstanceSecrets({
      appId: candidate.appId,
      sourceId: event.sourceId,
      workspaceId: source.workspaceId,
      preview: true,
      declarations: candidate.requiredSecrets,
    });
    const hostname = previewHostname({
      appId: candidate.appId,
      domain: candidate.config.preview!.domain,
      pullRequestNumber: pullRequest.number,
      sourceId: event.sourceId,
    });
    const snapshot = createPreviewAppSnapshot(candidate.config, {
      branch: pullRequest.headBranch,
      hostname,
    });
    const digests = calculateReleaseDeploymentDigest({
      commitSha: pullRequest.headSha,
      deployable: snapshot,
      deploymentInputs: candidate.config.deploymentInputs,
      repositoryTree,
      server: candidate.server,
    });
    const admission = await admitPreviewDeployment({
      requiredSecrets: candidate.requiredSecrets,
      targetEnvironment: candidate.targetEnvironment,
      targetConfigDigest: candidate.targetConfigDigest,
      appId: candidate.appId,
      branch: pullRequest.headBranch,
      commitSha: pullRequest.headSha,
      config: snapshot,
      deploymentDigest: digests.deploymentDigest,
      hostname,
      manifestDigest: candidate.manifestDigest!,
      pullRequestNumber: pullRequest.number,
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
    if (admission.supersededDeploymentIds.length > 0) {
      await emitPreviewNotification(
        admission.environmentId,
        "preview.superseded",
      ).catch(() => undefined);
    }
    if (admission.deploymentId && admission.created) {
      await emitDeploymentNotification(
        admission.deploymentId,
        "deployment.queued",
      ).catch(() => undefined);
      await publishPreviewDeploymentStatus(
        admission.deploymentId,
        "queued",
      ).catch(() => undefined);
    }
    if (admission.deploymentId && admission.shouldEnqueue) {
      // Signal delivery is uncertain when Temporal is unavailable. Keep the
      // accepted deployment queued so this Activity retry can safely signal
      // the same deployment ID again.
      await enqueueDeployment({
        appId: candidate.appId,
        buildConcurrency: candidate.server.buildConcurrency ?? 1,
        deploymentId: admission.deploymentId,
        previewBuildConcurrency: candidate.server.previewBuildConcurrency ?? 1,
        priority: "preview",
        serverIp: candidate.server.ip,
      });
    }
  }
  await publishPreviewPullRequestComment({
    pullRequestNumber: pullRequest.number,
    sourceId: event.sourceId,
  }).catch(() => undefined);
  return {
    cleanupIds: cleanup.cleanupIds,
    deploymentIds: admissions
      .map((admission) => admission.deploymentId)
      .filter((id): id is string => Boolean(id)),
    retry: admissions.some((admission) => admission.deferred),
  };
}
