import { and, eq, isNotNull, notInArray } from "drizzle-orm";
import {
  evaluateAutoDeployPause,
  isNormalizedResource,
} from "@workspace/towbar-core";

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
import { createDeferredAutomaticDeployment } from "../auto-deploy-controls/service.js";
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

export async function scheduleLatestAutomaticDeploymentsForSource(input: {
  sourceId: string;
  workspaceId: string;
}) {
  const [source] = await getTowbarDatabase()
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
  if (!source?.latestCommitSha) return { deploymentIds: [] };
  return await scheduleEligibleAutomaticDeployments({
    commitSha: source.latestCommitSha,
    sourceId: input.sourceId,
    workspaceId: input.workspaceId,
  });
}

export async function admitDueDeferredAutomaticDeployments() {
  const sourceRows = await getTowbarDatabase()
    .selectDistinct({ sourceId: apps.sourceId, workspaceId: apps.workspaceId })
    .from(apps)
    .where(isNotNull(apps.deferredAutomaticDeployment));
  let deploymentsQueued = 0;
  for (const source of sourceRows) {
    const result = await scheduleLatestAutomaticDeploymentsForSource(source);
    deploymentsQueued += result.deploymentIds.length;
  }
  return deploymentsQueued;
}

export async function scheduleEligibleAutomaticDeployments(input: {
  commitSha: string;
  sourceId: string;
  syncId?: string;
  workspaceId: string;
}) {
  const database = getTowbarDatabase();
  const [source] = await database
    .select({
      autoDeployPaused: sources.autoDeployPaused,
      latestCommitSha: sources.latestCommitSha,
    })
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
      autoDeployPaused: apps.autoDeployPaused,
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

  const eligibleIds = eligible.map((candidate) => candidate.appId);
  await database
    .update(apps)
    .set({ deferredAutomaticDeployment: null })
    .where(
      and(
        eq(apps.sourceId, input.sourceId),
        isNotNull(apps.deferredAutomaticDeployment),
        ...(eligibleIds.length ? [notInArray(apps.id, eligibleIds)] : []),
      ),
    );

  const results = await Promise.all(
    eligible.map(async (candidate) => {
      if (!candidate.deploymentDigest) {
        throw new Error("Automatic deployment candidate is not materialized");
      }
      const gate = evaluateAutoDeployPause({
        deployablePaused: candidate.autoDeployPaused,
        sourcePaused: source.autoDeployPaused,
      });
      if (gate.paused) {
        await database
          .update(apps)
          .set({
            deferredAutomaticDeployment: createDeferredAutomaticDeployment({
              commitSha: input.commitSha,
              deploymentDigest: candidate.deploymentDigest,
              gate,
              manifestId: candidate.manifestId,
            }),
          })
          .where(eq(apps.id, candidate.appId));
        return null;
      }
      const result = await requestAppDeployment({
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
      await database
        .update(apps)
        .set({ deferredAutomaticDeployment: null })
        .where(eq(apps.id, candidate.appId));
      return result;
    }),
  );
  return {
    deploymentIds: results.flatMap((result) =>
      result ? [result.deployment.id] : [],
    ),
  };
}
