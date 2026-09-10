import { and, desc, eq, inArray } from "drizzle-orm";
import {
  sourceEnvironments,
  sourceSyncs,
} from "@workspace/towbar-database/schema";
import { getTowbarDatabase } from "../../infrastructure/database.js";

export async function environmentSyncStatuses(sourceIds: string[]) {
  if (!sourceIds.length) return [];
  const database = getTowbarDatabase();
  const attempts = database
    .selectDistinctOn(
      [sourceSyncs.sourceEnvironmentId, sourceSyncs.mappingRevision],
      {
        environmentId: sourceSyncs.sourceEnvironmentId,
        mappingRevision: sourceSyncs.mappingRevision,
        status: sourceSyncs.status,
        finishedAt: sourceSyncs.finishedAt,
        issues: sourceSyncs.issues,
      },
    )
    .from(sourceSyncs)
    .where(inArray(sourceSyncs.sourceId, sourceIds))
    .orderBy(
      sourceSyncs.sourceEnvironmentId,
      sourceSyncs.mappingRevision,
      desc(sourceSyncs.createdAt),
      desc(sourceSyncs.id),
    )
    .as("current_mapping_attempts");
  const rows = await database
    .select({
      environment: sourceEnvironments,
      attempt: {
        status: attempts.status,
        finishedAt: attempts.finishedAt,
        issues: attempts.issues,
      },
    })
    .from(sourceEnvironments)
    .leftJoin(
      attempts,
      and(
        eq(attempts.environmentId, sourceEnvironments.id),
        eq(attempts.mappingRevision, sourceEnvironments.mappingRevision),
      ),
    )
    .where(inArray(sourceEnvironments.sourceId, sourceIds))
    .orderBy(sourceEnvironments.name);
  return rows.map(({ environment, attempt }) => ({
    ...environment,
    latestSyncStatus: attempt?.status ?? ("never" as const),
    latestSyncFinishedAt: attempt?.finishedAt ?? null,
    latestSyncIssues: attempt?.issues ?? [],
  }));
}

export function summarizeSyncStatus(statuses: string[]) {
  if (!statuses.length) return "never";
  return (
    ["failed", "running", "queued", "never", "succeeded"].find((status) =>
      statuses.includes(status),
    ) ?? "never"
  );
}
