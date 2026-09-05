import { and, eq, isNull, sql } from "drizzle-orm";
import {
  type MonitoringAggregates,
  type MonitoringSeries,
  monitoringRangeSeconds,
} from "@workspace/towbar-core";
import { apps } from "@workspace/towbar-database/schema";
import { notFound } from "../../http/errors.js";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import { getServer } from "../servers/service.js";
import { getMonitoringAgent } from "./lifecycle.js";

type MetricsQuery = {
  range: keyof typeof monitoringRangeSeconds;
  environment: "production" | "preview";
  previewId?: string;
};

export async function getMonitoringHistory(
  input: MetricsQuery & {
    workspaceId: string;
    serverId?: string;
    deployableId?: string;
    kind?: "app" | "resource";
  },
  now = new Date(),
) {
  const database = getTowbarDatabase();
  let serverId = input.serverId;
  if (input.deployableId) {
    const [app] = await database
      .select({ serverId: apps.serverId, kind: apps.kind })
      .from(apps)
      .where(
        and(
          eq(apps.id, input.deployableId),
          eq(apps.workspaceId, input.workspaceId),
          isNull(apps.archivedAt),
        ),
      )
      .limit(1);
    if (
      !app ||
      (input.kind === "app" ? app.kind !== "app" : app.kind === "app")
    )
      throw notFound("Workload");
    serverId = app.serverId;
  }
  if (!serverId) throw notFound("Server");
  await getServer(serverId, input.workspaceId);
  const agent = await getMonitoringAgent(serverId, input.workspaceId);
  const seconds = Math.min(
    monitoringRangeSeconds[input.range],
    agent.retentionDays * 86400,
  );
  // At most 360 points per instance; preserve separate instances so peaks are never
  // incorrectly summed across rolling releases or independent preview environments.
  const step = Math.max(
    seconds > 86400 ? 60 : 30,
    Math.ceil(seconds / 360 / 30) * 30,
  );
  const end = new Date(
    Math.floor(now.getTime() / step / 1000) * step * 1000 + step * 1000,
  );
  const start = new Date(
    Math.max(
      now.getTime() - seconds * 1000,
      now.getTime() - agent.retentionDays * 86400_000,
    ),
  );
  const scope = input.deployableId
    ? sql`deployable_id=${input.deployableId}::uuid and ${input.environment === "production" ? sql`preview_id is null` : input.previewId ? sql`preview_id=${input.previewId}::uuid` : sql`preview_id is not null`}`
    : sql`entity_id='host'`;
  const filter = sql`server_id=${serverId}::uuid and bucket_at>=${start.toISOString()}::timestamptz and bucket_at<${end.toISOString()}::timestamptz and ${scope}`;
  const instances = await database.execute<{
    entity_id: string;
    deployment_id: string | null;
    preview_id: string | null;
  }>(sql`
    select entity_id,max(deployment_id::text) deployment_id,max(preview_id::text) preview_id
    from towbar_monitoring_samples where ${filter} group by entity_id order by max(bucket_at) desc limit 33`);
  const series: MonitoringSeries[] = instances.slice(0, 32).map((row) => ({
    id: row.entity_id,
    deploymentId: row.deployment_id,
    previewId: row.preview_id,
    points: [],
  }));
  if (series.length) {
    const ids = sql.join(
      series.map((row) => sql`${row.id}`),
      sql`, `,
    );
    const rows = await database.execute<{
      entity_id: string;
      at: string;
      metrics: MonitoringAggregates;
    }>(sql`
      with values_by_metric as (
        select entity_id,to_timestamp(floor(extract(epoch from bucket_at)/${step})*${step}) at,m.key,
          sum((m.value->>'sum')::double precision) total,
          sum((m.value->>'count')::integer) samples,
          min((m.value->>'min')::double precision) minimum,
          max((m.value->>'max')::double precision) maximum
        from towbar_monitoring_samples cross join lateral jsonb_each(metrics) m
        where ${filter} and entity_id in (${ids}) group by entity_id,at,m.key
      ) select entity_id,at::text,jsonb_object_agg(key,jsonb_build_object('sum',total,'count',samples,'min',minimum,'max',maximum)) metrics
      from values_by_metric group by entity_id,at order by at`);
    const byId = new Map(series.map((row) => [row.id, row]));
    for (const row of rows)
      byId.get(row.entity_id)?.points.push({
        at: new Date(row.at).toISOString(),
        metrics: row.metrics,
      });
  }
  const eventScope = input.deployableId
    ? sql`app_id=${input.deployableId}::uuid and ${input.environment === "production" ? sql`preview_environment_id is null` : input.previewId ? sql`preview_environment_id=${input.previewId}::uuid` : sql`preview_environment_id is not null`}`
    : sql`true`;
  const events = await database.execute<{
    id: string;
    at: string;
    state: string;
  }>(sql`
    select id,created_at::text at,state from towbar_deployments where server_id=${serverId}::uuid and created_at>=${start.toISOString()}::timestamptz and created_at<${end.toISOString()}::timestamptz and ${eventScope} order by created_at desc limit 200`);
  const restarts = await database.execute<{ id: string; at: string }>(sql`
    with changes as (select entity_id,bucket_at,
      (metrics->'restartCount'->>'max')::double precision restarts,
      lag((metrics->'restartCount'->>'max')::double precision) over(partition by entity_id order by bucket_at) previous
      from towbar_monitoring_samples where ${filter})
    select entity_id id,bucket_at::text at from changes where restarts>previous order by bucket_at desc limit 200`);
  return {
    agent,
    serverId,
    range: input.range,
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    stepSeconds: step,
    series,
    seriesLimited: instances.length > 32,
    events: [
      ...events.map((row) => ({
        ...row,
        at: new Date(row.at).toISOString(),
        type: "deployment" as const,
      })),
      ...restarts.map((row) => ({
        ...row,
        at: new Date(row.at).toISOString(),
        type: "restart" as const,
        state: "restarted",
      })),
    ].sort((a, b) => b.at.localeCompare(a.at)),
  };
}
