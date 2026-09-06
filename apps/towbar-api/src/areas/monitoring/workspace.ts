import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  apps,
  scoutAlertIncidents,
  scoutAlertRules,
  servers,
} from "@workspace/towbar-database/schema";
import { getTowbarDatabase } from "../../infrastructure/database.js";

export const monitoringEntitiesQuery = z.object({
  search: z.string().trim().max(120).default(""),
  kind: z.enum(["all", "server", "app", "resource"]).default("all"),
  after: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(100),
});
export const monitoringOverviewQuery = z
  .object({
    state: z.enum(["all", "active", "resolved"]).default("all"),
    before: z.iso.datetime({ offset: true }).optional(),
    beforeId: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .refine(
    (v) => Boolean(v.before) === Boolean(v.beforeId),
    "A cursor needs both before and beforeId",
  );

export async function listMonitoringEntities(
  workspaceId: string,
  input: z.infer<typeof monitoringEntitiesQuery>,
) {
  const database = getTowbarDatabase();
  const search = `%${input.search.replace(/[\\%_]/g, "\\$&")}%`;
  const rows = await database.execute<{
    id: string;
    key: string;
    name: string;
    kind: "server" | "app" | "resource";
    serverId: string;
    serverName: string;
    sourceId: string | null;
  }>(sql`
    with entities as (
      select id,'server:'||id::text key,canonical_ip name,'server' kind,id "serverId",canonical_ip "serverName",null::uuid "sourceId"
      from towbar_servers where workspace_id=${workspaceId}::uuid and archived_at is null
      union all
      select a.id,(case when a.kind='app' then 'app:' else 'resource:' end)||a.id::text key,a.name,
        case when a.kind='app' then 'app' else 'resource' end kind,a.server_id "serverId",s.canonical_ip "serverName",a.source_id "sourceId"
      from towbar_apps a join towbar_servers s on s.id=a.server_id and s.workspace_id=a.workspace_id
      where a.workspace_id=${workspaceId}::uuid and a.archived_at is null and s.archived_at is null
    ) select * from entities where (${input.kind}='all' or kind=${input.kind})
      and (name ilike ${search} or "serverName" ilike ${search})
      ${input.after ? sql`and key>${input.after}` : sql``}
      order by key limit ${input.limit + 1}`);
  const entities = rows.slice(0, input.limit);
  return {
    entities,
    nextAfter: rows.length > input.limit ? entities.at(-1)!.key : null,
  };
}

type OverviewQuery = z.infer<typeof monitoringOverviewQuery>;
const entity = {
  name: apps.name,
  kind: apps.kind,
  sourceId: apps.sourceId,
  archivedAt: apps.archivedAt,
};
function workspaceFilter(
  workspaceId: string,
  input: OverviewQuery,
  table: typeof scoutAlertRules | typeof scoutAlertIncidents,
) {
  const at = "openedAt" in table ? table.openedAt : table.createdAt;
  const cursor =
    input.before && input.beforeId
      ? or(
          lt(at, new Date(input.before)),
          and(eq(at, new Date(input.before)), lt(table.id, input.beforeId)),
        )
      : undefined;
  return and(
    eq(table.workspaceId, workspaceId),
    isNull(servers.archivedAt),
    cursor,
  );
}
export async function listWorkspaceIncidents(
  workspaceId: string,
  input: OverviewQuery,
) {
  const db = getTowbarDatabase();
  const joins = workspaceFilter(workspaceId, input, scoutAlertIncidents);
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
    .where(
      and(
        joins,
        input.state === "active"
          ? isNull(scoutAlertIncidents.resolvedAt)
          : input.state === "resolved"
            ? sql`${scoutAlertIncidents.resolvedAt} is not null`
            : undefined,
      ),
    )
    .orderBy(desc(scoutAlertIncidents.openedAt), desc(scoutAlertIncidents.id))
    .limit(input.limit + 1);
  const items = rows.slice(0, input.limit),
    last = items.at(-1)?.incident;
  return {
    items,
    nextBefore: rows.length > input.limit ? last!.openedAt.toISOString() : null,
    nextBeforeId: rows.length > input.limit ? last!.id : null,
  };
}
export async function listWorkspaceAlerts(
  workspaceId: string,
  input: OverviewQuery,
) {
  const db = getTowbarDatabase();
  const joins = workspaceFilter(workspaceId, input, scoutAlertRules);

  const rows = await db
    .select({
      rule: scoutAlertRules,
      workload: entity,
      serverName: servers.canonicalIp,
    })
    .from(scoutAlertRules)
    .innerJoin(
      servers,
      and(
        eq(servers.id, scoutAlertRules.serverId),
        eq(servers.workspaceId, workspaceId),
      ),
    )
    .leftJoin(
      apps,
      and(
        eq(apps.id, scoutAlertRules.deployableId),
        eq(apps.workspaceId, workspaceId),
      ),
    )
    .where(and(joins, isNull(scoutAlertRules.deletedAt)))
    .orderBy(desc(scoutAlertRules.createdAt), desc(scoutAlertRules.id))
    .limit(input.limit + 1);
  const items = rows.slice(0, input.limit),
    last = items.at(-1)?.rule;
  return {
    items,
    nextBefore:
      rows.length > input.limit ? last!.createdAt.toISOString() : null,
    nextBeforeId: rows.length > input.limit ? last!.id : null,
  };
}
