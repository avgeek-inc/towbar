import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  apps,
  scoutAlertIncidents,
  servers,
  sourceEnvironments,
} from "@workspace/towbar-database/schema";
import { getTowbarDatabase } from "../../infrastructure/database.js";

export const monitoringOverviewQuery = z
  .object({
    state: z.enum(["active", "resolved"]).default("active"),
    severity: z.enum(["all", "critical", "warning"]).default("all"),
    before: z.iso.datetime({ offset: true }).optional(),
    beforeId: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .refine(
    (value) => Boolean(value.before) === Boolean(value.beforeId),
    "A cursor needs both before and beforeId",
  );

type OverviewQuery = z.infer<typeof monitoringOverviewQuery>;
const entity = {
  name: apps.name,
  environmentName: sourceEnvironments.name,
  kind: apps.kind,
  sourceId: apps.sourceId,
  archivedAt: apps.archivedAt,
};

function workspaceFilter(workspaceId: string, input: OverviewQuery) {
  const cursor =
    input.before && input.beforeId
      ? or(
          lt(scoutAlertIncidents.openedAt, new Date(input.before)),
          and(
            eq(scoutAlertIncidents.openedAt, new Date(input.before)),
            lt(scoutAlertIncidents.id, input.beforeId),
          ),
        )
      : undefined;
  return and(
    eq(scoutAlertIncidents.workspaceId, workspaceId),
    isNull(servers.archivedAt),
    input.state === "active"
      ? isNull(scoutAlertIncidents.resolvedAt)
      : sql`${scoutAlertIncidents.resolvedAt} is not null`,
    input.severity === "all"
      ? undefined
      : eq(scoutAlertIncidents.severity, input.severity),
    cursor,
  );
}

export async function listWorkspaceIncidents(
  workspaceId: string,
  input: OverviewQuery,
) {
  const db = getTowbarDatabase();
  const rows = await db
    .select({
      incident: scoutAlertIncidents,
      workload: entity,
      serverName: servers.canonicalIp,
    })
    .from(scoutAlertIncidents)
    .innerJoin(
      servers,
      and(
        eq(servers.id, scoutAlertIncidents.serverId),
        eq(servers.workspaceId, workspaceId),
      ),
    )
    .leftJoin(
      apps,
      and(
        eq(apps.id, scoutAlertIncidents.deployableId),
        eq(apps.workspaceId, workspaceId),
      ),
    )
    .leftJoin(
      sourceEnvironments,
      eq(sourceEnvironments.id, apps.sourceEnvironmentId),
    )
    .where(workspaceFilter(workspaceId, input))
    .orderBy(desc(scoutAlertIncidents.openedAt), desc(scoutAlertIncidents.id))
    .limit(input.limit + 1);
  const items = rows.slice(0, input.limit);
  const last = items.at(-1)?.incident;
  return {
    items,
    nextBefore: rows.length > input.limit ? last!.openedAt.toISOString() : null,
    nextBeforeId: rows.length > input.limit ? last!.id : null,
  };
}
