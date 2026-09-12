import { and, eq, isNotNull, isNull, notInArray } from "drizzle-orm";
import {
  evaluateAutoDeployPause,
  isNormalizedResource,
} from "@workspace/towbar-core";

import {
  apps,
  releases,
  servers,
  sourceEnvironments,
  sourceSyncs,
  sources,
} from "@workspace/towbar-database/schema";

import { getTowbarDatabase } from "../../infrastructure/database.js";
import { selectAutomaticDeploymentCandidates } from "./automatic-deployment-selection.js";
import { assertRequiredInstanceSecrets } from "./secrets.js";
import { HttpError } from "../../http/errors.js";
import { requestAppDeployment } from "./service.js";
import { createDeferredAutomaticDeployment } from "../auto-deploy-controls/service.js";
import { scheduleSourcePreviewReconciliations } from "../previews/reconciliation-scheduler.js";
import { requestDisabledPreviewCleanups } from "../previews/cleanup.js";

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
      sourceEnvironmentId: sourceSyncs.sourceEnvironmentId,
      deployAfterSync: sourceSyncs.deployAfterSync,
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
  if (
    !sync ||
    !sync.sourceEnvironmentId ||
    !sync.deployAfterSync ||
    !isSourceSyncEligibleForAutomaticDeployments(sync)
  ) {
    return { deploymentIds: [] };
  }
  const result = await scheduleEligibleAutomaticDeployments({
    commitSha: sync.commitSha,
    sourceId: sync.sourceId,
    sourceEnvironmentId: sync.sourceEnvironmentId,
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
  sourceEnvironmentId?: string;
  sourceId: string;
  workspaceId: string;
}) {
  const environments = await getTowbarDatabase()
    .select({
      id: sourceEnvironments.id,
      commitSha: sourceEnvironments.latestCommitSha,
    })
    .from(sourceEnvironments)
    .innerJoin(sources, eq(sources.id, sourceEnvironments.sourceId))
    .where(
      and(
        eq(sources.id, input.sourceId),
        eq(sources.workspaceId, input.workspaceId),
        eq(sources.status, "active"),
        isNull(sourceEnvironments.disconnectedAt),
        ...(input.sourceEnvironmentId
          ? [eq(sourceEnvironments.id, input.sourceEnvironmentId)]
          : []),
      ),
    );
  const deploymentIds: string[] = [];
  for (const environment of environments) {
    if (!environment.commitSha) continue;
    const result = await scheduleEligibleAutomaticDeployments({
      ...input,
      sourceEnvironmentId: environment.id,
      commitSha: environment.commitSha,
    });
    deploymentIds.push(...result.deploymentIds);
  }
  return { deploymentIds };
}

export async function admitResumedAutomaticDeployments() {
  const sourceRows = await getTowbarDatabase()
    .selectDistinct({
      sourceId: apps.sourceId,
      workspaceId: apps.workspaceId,
      sourceEnvironmentId: sourceEnvironments.id,
    })
    .from(apps)
    .innerJoin(sources, eq(sources.id, apps.sourceId))
    .innerJoin(
      sourceEnvironments,
      eq(sourceEnvironments.id, apps.sourceEnvironmentId),
    )
    .where(
      and(
        isNotNull(apps.deferredAutomaticDeployment),
        isNull(sourceEnvironments.disconnectedAt),
        eq(sourceEnvironments.autoDeployPaused, false),
        eq(apps.autoDeployPaused, false),
        eq(sources.autoDeployPaused, false),
        eq(sources.status, "active"),
      ),
    );
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
  sourceEnvironmentId: string;
  syncId?: string;
  workspaceId: string;
}) {
  const database = getTowbarDatabase();
  const [source] = await database
    .select({
      autoDeployPaused: sources.autoDeployPaused,
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
  const [environment] = await database
    .select({
      latestCommitSha: sourceEnvironments.latestCommitSha,
      autoDeployPaused: sourceEnvironments.autoDeployPaused,
      mappingRevision: sourceEnvironments.mappingRevision,
      syncedMappingRevision: sourceSyncs.mappingRevision,
    })
    .from(sourceEnvironments)
    .innerJoin(
      sourceSyncs,
      eq(sourceSyncs.id, sourceEnvironments.latestSuccessfulSyncId),
    )
    .where(
      and(
        eq(sourceEnvironments.id, input.sourceEnvironmentId),
        eq(sourceEnvironments.sourceId, input.sourceId),
        isNull(sourceEnvironments.disconnectedAt),
      ),
    )
    .limit(1);
  if (
    !source ||
    !environment ||
    environment.latestCommitSha !== input.commitSha ||
    environment.mappingRevision !== environment.syncedMappingRevision
  ) {
    return { deploymentIds: [] };
  }

  const candidates = await database
    .select({
      appId: apps.id,
      archivedAt: apps.archivedAt,
      autoDeployPaused: apps.autoDeployPaused,
      config: apps.config,
      deploymentDigest: apps.deploymentDigest,
      manifestId: apps.id,
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
        eq(apps.sourceEnvironmentId, input.sourceEnvironmentId),
        eq(apps.workspaceId, input.workspaceId),
      ),
    );
  const releaseStates = await database
    .select({
      currentDeploymentDigest: releases.deploymentDigest,
      manifestId: apps.id,
    })
    .from(apps)
    .leftJoin(
      releases,
      and(
        eq(releases.appId, apps.id),
        eq(releases.status, "current"),
        eq(releases.environment, "production"),
      ),
    )
    .where(
      and(
        eq(apps.sourceId, input.sourceId),
        eq(apps.sourceEnvironmentId, input.sourceEnvironmentId),
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
        eq(apps.sourceEnvironmentId, input.sourceEnvironmentId),
        isNotNull(apps.deferredAutomaticDeployment),
        ...(eligibleIds.length ? [notInArray(apps.id, eligibleIds)] : []),
      ),
    );

  const results = await Promise.all(
    eligible.map(async (candidate) => {
      if (!candidate.deploymentDigest) {
        throw new Error("Automatic deployment candidate is not materialized");
      }
      try {
        await assertRequiredInstanceSecrets({
          appId: candidate.appId,
          sourceId: input.sourceId,
          workspaceId: input.workspaceId,
        });
      } catch (error) {
        if (
          error instanceof HttpError &&
          ["REQUIRED_SECRETS_MISSING", "SECRET_REFERENCE_INVALID"].includes(
            error.code,
          )
        )
          return null;
        throw error;
      }
      const gate = evaluateAutoDeployPause({
        deployablePaused: candidate.autoDeployPaused,
        sourcePaused:
          source.autoDeployPaused || Boolean(environment?.autoDeployPaused),
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
