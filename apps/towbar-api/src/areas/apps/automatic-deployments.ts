import { and, eq } from "drizzle-orm";
import { isNormalizedResource } from "@workspace/towbar-core";

import {
  apps,
  releases,
  servers,
  sourceSyncs,
  sources,
} from "@workspace/towbar-database/schema";

import { getTowbarDatabase } from "../../infrastructure/database.js";
import { selectAutomaticDeploymentCandidates } from "./automatic-deployment-selection.js";
import { requestAppDeployment } from "./service.js";
import { requestDisabledPreviewCleanups } from "../previews/cleanup.js";
import { scheduleSourcePreviewReconciliations } from "../previews/service.js";

type SourceSyncAdmission = {
  commitSha: string | null;
  requestedBy: string | null;
  status: "queued" | "running" | "succeeded" | "failed";
};

export function isSourceSyncEligibleForAutomaticDeployments(
  sync: SourceSyncAdmission,
): sync is SourceSyncAdmission & { commitSha: string } {
  return sync.status === "succeeded" && sync.commitSha !== null;
}

export function sourceSyncDeploymentIdempotencyKey(input: {
  commitSha: string;
  deploymentDigest: string;
  manifestId: string;
  sourceId: string;
  syncId?: string;
}) {
  return `${input.syncId ? `sync:${input.syncId}` : "push"}:${input.sourceId}:${input.commitSha}:${input.deploymentDigest}:${input.manifestId}`;
}

export async function scheduleSourceAutomaticDeployments(syncId: string) {
  const [sync] = await getTowbarDatabase()
    .select({
      commitSha: sourceSyncs.commitSha,
      requestedBy: sourceSyncs.requestedBy,
      sourceId: sourceSyncs.sourceId,
      status: sourceSyncs.status,
      workspaceId: sources.workspaceId,
    })
    .from(sourceSyncs)
    .innerJoin(sources, eq(sources.id, sourceSyncs.sourceId))
    .where(eq(sourceSyncs.id, syncId))
    .limit(1);
  if (!sync || !isSourceSyncEligibleForAutomaticDeployments(sync)) {
    return { deploymentIds: [] };
  }
  const result = await scheduleEligibleAutomaticDeployments({
    commitSha: sync.commitSha,
    sourceId: sync.sourceId,
    syncId,
    workspaceId: sync.workspaceId,
  });
  await requestDisabledPreviewCleanups(sync.sourceId);
  await scheduleSourcePreviewReconciliations(sync.sourceId);
  return result;
}

export function continueAutomaticDeployments(deploymentId: string) {
  // Existing deployment Workflow histories contain this activity. Keep its
  // signed API target available as a no-op until those histories have drained.
  void deploymentId;
  return { deploymentIds: [] };
}

async function scheduleEligibleAutomaticDeployments(input: {
  commitSha: string;
  sourceId: string;
  syncId?: string;
  workspaceId: string;
}) {
  const database = getTowbarDatabase();
  const [source] = await database
    .select({ latestCommitSha: sources.latestCommitSha })
    .from(sources)
    .where(
      and(
        eq(sources.id, input.sourceId),
        eq(sources.workspaceId, input.workspaceId),
        eq(sources.status, "active"),
      ),
    )
    .limit(1);
  if (source?.latestCommitSha !== input.commitSha) {
    return { deploymentIds: [] };
  }

  const candidates = await database
    .select({
      appId: apps.id,
      archivedAt: apps.archivedAt,
      config: apps.config,
      deploymentDigest: apps.deploymentDigest,
      manifestId: apps.manifestId,
      kind: apps.kind,
      sourceRevision: apps.sourceRevision,
      serverConfigDigest: servers.configDigest,
      serverPreparedAt: servers.preparedAt,
      serverPreparedConfigDigest: servers.preparedConfigDigest,
    })
    .from(apps)
    .innerJoin(servers, eq(servers.id, apps.serverId))
    .where(
      and(
        eq(apps.sourceId, input.sourceId),
        eq(apps.workspaceId, input.workspaceId),
      ),
    );
  const releaseStates = await database
    .select({
      currentDeploymentDigest: releases.deploymentDigest,
      manifestId: apps.manifestId,
    })
    .from(apps)
    .leftJoin(
      releases,
      and(eq(releases.appId, apps.id), eq(releases.status, "current")),
    )
    .where(
      and(
        eq(apps.sourceId, input.sourceId),
        eq(apps.workspaceId, input.workspaceId),
      ),
    );
  const eligible = selectAutomaticDeploymentCandidates({
    candidates: candidates.map((candidate) => ({
      ...candidate,
      serverReady:
        Boolean(candidate.serverPreparedAt) &&
        candidate.serverPreparedConfigDigest === candidate.serverConfigDigest,
    })),
    commitSha: input.commitSha,
    releases: releaseStates,
  });

  const results = await Promise.all(
    eligible.map((candidate) => {
      if (!candidate.deploymentDigest) {
        throw new Error("Automatic deployment candidate is not materialized");
      }
      return requestAppDeployment({
        appId: candidate.appId,
        expectedType: isNormalizedResource(candidate.config)
          ? "resource"
          : "app",
        expectedCommitSha: input.commitSha,
        idempotencyKey: sourceSyncDeploymentIdempotencyKey({
          commitSha: input.commitSha,
          deploymentDigest: candidate.deploymentDigest,
          manifestId: candidate.manifestId,
          sourceId: input.sourceId,
          syncId: input.syncId,
        }),
        requestedBy: null,
        workspaceId: input.workspaceId,
      });
    }),
  );
  return {
    deploymentIds: results.map((result) => result.deployment.id),
  };
}
