import { and, desc, eq, isNull, ne } from "drizzle-orm";

import {
  createPreviewAppSnapshot,
  isNormalizedResource,
  previewHostname,
  shouldDeployForChangedPaths,
} from "@workspace/towbar-core";
import { previewPullRequestEventSchema } from "@workspace/towbar-core/temporal";
import {
  apps,
  githubInstallations,
  previewEnvironments,
  servers,
  sources,
} from "@workspace/towbar-database/schema";

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
  requestPreviewInputMismatchCleanups,
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
  if (!source || source.status !== "active") {
    return { cleanupIds: [], deploymentIds: [], retry: false };
  }
  const pullRequest = await fetchGitHubPullRequest({
    installationId: source.installationId,
    pullRequestNumber: event.pullRequestNumber,
    repositoryName: source.repositoryName,
    repositoryOwner: source.repositoryOwner,
  });
  const disposition = previewPullRequestDisposition({
    pullRequest,
    repositoryName: source.repositoryName,
    repositoryOwner: source.repositoryOwner,
    sourceBranch: source.branch,
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
  if (!source.latestManifestDigest) {
    return { cleanupIds: [], deploymentIds: [], retry: false };
  }

  const candidates = await database
    .select({
      appId: apps.id,
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
  const relevant = eligible.filter((candidate) =>
    shouldDeployForChangedPaths({
      changedPaths,
      deploymentInputs: candidate.config.deploymentInputs,
    }),
  );
  const relevantAppIds = new Set(relevant.map((candidate) => candidate.appId));
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
  const cleanup = await requestPreviewInputMismatchCleanups({
    appIds: eligible
      .filter((candidate) => !relevantAppIds.has(candidate.appId))
      .map((candidate) => candidate.appId),
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
    const hostname = previewHostname({
      appId: candidate.manifestId,
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
      appId: candidate.appId,
      branch: pullRequest.headBranch,
      commitSha: pullRequest.headSha,
      config: snapshot,
      deploymentDigest: digests.deploymentDigest,
      hostname,
      manifestDigest: source.latestManifestDigest,
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
