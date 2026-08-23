import { and, eq } from "drizzle-orm";
import { isNormalizedResource } from "@workspace/towbar-core";

import {
  apps,
  deployments,
  releases,
  sourceSyncs,
  sources,
} from "@workspace/towbar-database/schema";

import { getTowbarDatabase } from "../../infrastructure/database.js";
import { selectAutomaticDeploymentCandidates } from "./automatic-deployment-selection.js";
import { requestAppDeployment } from "./service.js";

export async function scheduleSourcePushDeployments(syncId: string) {
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
  if (
    !sync ||
    sync.requestedBy ||
    sync.status !== "succeeded" ||
    !sync.commitSha
  ) {
    return { deploymentIds: [] };
  }
  return await scheduleEligibleAutomaticDeployments({
    commitSha: sync.commitSha,
    sourceId: sync.sourceId,
    workspaceId: sync.workspaceId,
  });
}

export async function continueAutomaticDeployments(deploymentId: string) {
  const [deployment] = await getTowbarDatabase()
    .select({
      commitSha: deployments.commitSha,
      kind: deployments.kind,
      requestedBy: deployments.requestedBy,
      sourceId: deployments.sourceId,
      state: deployments.state,
      workspaceId: deployments.workspaceId,
    })
    .from(deployments)
    .where(eq(deployments.id, deploymentId))
    .limit(1);
  if (
    !deployment ||
    deployment.requestedBy ||
    deployment.kind !== "deploy" ||
    !["succeeded", "succeeded_with_warnings"].includes(deployment.state)
  ) {
    return { deploymentIds: [] };
  }
  return await scheduleEligibleAutomaticDeployments(deployment);
}

async function scheduleEligibleAutomaticDeployments(input: {
  commitSha: string;
  sourceId: string;
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
    })
    .from(apps)
    .where(
      and(
        eq(apps.sourceId, input.sourceId),
        eq(apps.workspaceId, input.workspaceId),
      ),
    );
  const releaseStates = await database
    .select({
      archivedAt: apps.archivedAt,
      currentDeploymentDigest: releases.deploymentDigest,
      desiredDeploymentDigest: apps.deploymentDigest,
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
    candidates,
    commitSha: input.commitSha,
    releases: releaseStates,
  });

  const results = await Promise.all(
    eligible.map((candidate) =>
      requestAppDeployment({
        appId: candidate.appId,
        expectedType: isNormalizedResource(candidate.config)
          ? "resource"
          : "app",
        expectedCommitSha: input.commitSha,
        idempotencyKey: `push:${input.sourceId}:${input.commitSha}:${candidate.deploymentDigest}:${candidate.manifestId}`,
        requestedBy: null,
        synchronize: false,
        workspaceId: input.workspaceId,
      }),
    ),
  );
  return {
    deploymentIds: results.map((result) => result.deployment.id),
  };
}
