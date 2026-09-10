import { and, desc, eq, inArray, notInArray } from "drizzle-orm";
import {
  apps,
  deployments,
  githubWebhookDeliveries,
  imageVulnerabilityScans,
  releases,
  resourceOperations,
  sourceSyncs,
  sources,
} from "@workspace/towbar-database/schema";
import { executeEnvironmentSync } from "./environment-sync.js";
import { conflict, notFound } from "../../http/errors.js";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import {
  publicSourceSelection,
  publicSourceSyncSelection,
} from "./public-selections.js";

export async function listSources(workspaceId: string) {
  const database = getTowbarDatabase();
  const rows = await database
    .select({
      ...publicSourceSelection,
      autoDeployPaused: sources.autoDeployPaused,
    })
    .from(sources)
    .where(eq(sources.workspaceId, workspaceId))
    .orderBy(desc(sources.updatedAt));
  const ids = rows.map((source) => source.id);
  const syncs = ids.length
    ? await database
        .selectDistinctOn([sourceSyncs.sourceId], {
          sourceId: sourceSyncs.sourceId,
          status: sourceSyncs.status,
        })
        .from(sourceSyncs)
        .where(inArray(sourceSyncs.sourceId, ids))
        .orderBy(
          sourceSyncs.sourceId,
          desc(sourceSyncs.createdAt),
          desc(sourceSyncs.id),
        )
    : [];
  const statuses = new Map(syncs.map((sync) => [sync.sourceId, sync.status]));
  return rows.map((source) => ({
    ...source,
    latestSyncStatus: statuses.get(source.id) ?? "never",
  }));
}

export async function getSource(sourceId: string, workspaceId: string) {
  const [source] = await getTowbarDatabase()
    .select(publicSourceSelection)
    .from(sources)
    .where(and(eq(sources.id, sourceId), eq(sources.workspaceId, workspaceId)))
    .limit(1);
  if (!source) throw notFound("Source");
  return source;
}

export async function deleteSource(sourceId: string, workspaceId: string) {
  return await getTowbarDatabase().transaction(async (transaction) => {
    const [source] = await transaction
      .select({ id: sources.id })
      .from(sources)
      .where(
        and(eq(sources.id, sourceId), eq(sources.workspaceId, workspaceId)),
      )
      .for("update")
      .limit(1);
    if (!source) throw notFound("Source");
    const [
      activeDeployment,
      activeSync,
      activeOperation,
      activeVulnerabilityScan,
    ] = await Promise.all([
      transaction
        .select({ id: deployments.id })
        .from(deployments)
        .where(
          and(
            eq(deployments.sourceId, sourceId),
            notInArray(deployments.state, [
              "cancelled",
              "failed",
              "skipped",
              "succeeded",
              "succeeded_with_warnings",
            ]),
          ),
        )
        .limit(1),
      transaction
        .select({ id: sourceSyncs.id })
        .from(sourceSyncs)
        .where(
          and(
            eq(sourceSyncs.sourceId, sourceId),
            inArray(sourceSyncs.status, ["queued", "running"]),
          ),
        )
        .limit(1),
      transaction
        .select({ id: resourceOperations.id })
        .from(resourceOperations)
        .where(
          and(
            eq(resourceOperations.sourceId, sourceId),
            inArray(resourceOperations.state, ["queued", "running"]),
          ),
        )
        .limit(1),
      transaction
        .select({ id: imageVulnerabilityScans.id })
        .from(imageVulnerabilityScans)
        .where(
          and(
            eq(imageVulnerabilityScans.sourceId, sourceId),
            inArray(imageVulnerabilityScans.state, ["pending", "running"]),
          ),
        )
        .limit(1),
    ]);
    if (
      activeDeployment.length ||
      activeSync.length ||
      activeOperation.length ||
      activeVulnerabilityScan.length
    ) {
      throw conflict(
        "Cancel or wait for active Source operations before deletion",
        "SOURCE_BUSY",
      );
    }

    const appRows = await transaction
      .select({ id: apps.id })
      .from(apps)
      .where(eq(apps.sourceId, sourceId));
    const appIds = appRows.map((app) => app.id);
    if (appIds.length > 0) {
      await transaction.delete(releases).where(inArray(releases.appId, appIds));
    }
    await transaction
      .delete(imageVulnerabilityScans)
      .where(eq(imageVulnerabilityScans.sourceId, sourceId));
    await transaction
      .delete(deployments)
      .where(eq(deployments.sourceId, sourceId));
    await transaction.delete(apps).where(eq(apps.sourceId, sourceId));
    await transaction
      .delete(githubWebhookDeliveries)
      .where(eq(githubWebhookDeliveries.sourceId, sourceId));
    await transaction.delete(sources).where(eq(sources.id, sourceId));

    return { id: source.id };
  });
}

export async function executeSourceSync(syncId: string) {
  const [sync] = await getTowbarDatabase()
    .select({
      sourceId: sourceSyncs.sourceId,
      sourceEnvironmentId: sourceSyncs.sourceEnvironmentId,
      workspaceId: sources.workspaceId,
    })
    .from(sourceSyncs)
    .innerJoin(sources, eq(sources.id, sourceSyncs.sourceId))
    .where(eq(sourceSyncs.id, syncId))
    .limit(1);
  if (!sync) throw notFound("Source sync");
  if (!sync.sourceEnvironmentId) {
    const message = "Source sync requires an environment mapping.";
    await getTowbarDatabase()
      .update(sourceSyncs)
      .set({
        status: "failed",
        finishedAt: new Date(),
        issues: [{ path: [], message }],
      })
      .where(eq(sourceSyncs.id, syncId));
    throw conflict(message, "ENVIRONMENT_REQUIRED");
  }
  return executeEnvironmentSync(syncId, sync.workspaceId);
}

export async function listSourceSyncs(sourceId: string, workspaceId: string) {
  await getSource(sourceId, workspaceId);
  return await getTowbarDatabase()
    .select(publicSourceSyncSelection)
    .from(sourceSyncs)
    .where(eq(sourceSyncs.sourceId, sourceId))
    .orderBy(desc(sourceSyncs.createdAt));
}

export async function getSourceSync(
  sourceId: string,
  syncId: string,
  workspaceId: string,
) {
  await getSource(sourceId, workspaceId);
  const [sync] = await getTowbarDatabase()
    .select(publicSourceSyncSelection)
    .from(sourceSyncs)
    .where(and(eq(sourceSyncs.id, syncId), eq(sourceSyncs.sourceId, sourceId)))
    .limit(1);
  if (!sync) throw notFound("Source sync");
  return sync;
}
