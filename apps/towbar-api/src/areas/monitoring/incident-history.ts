import { type SQL, and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { apps, scoutAlertIncidents } from "@workspace/towbar-database/schema";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import { notFound } from "../../http/errors.js";
import { getServer } from "../servers/service.js";
import { getMonitoringAgent } from "./lifecycle.js";
import type { ScoutScope } from "./alert-rules.js";

export async function getScoutIncident(
  input: ScoutScope & { incidentId: string },
  now = new Date(),
) {
  const incidentId = z.string().uuid().parse(input.incidentId);
  const server = await getServer(input.serverId, input.workspaceId);
  const database = getTowbarDatabase();
  const [incident] = await database
    .select()
    .from(scoutAlertIncidents)
    .where(
      and(
        eq(scoutAlertIncidents.id, incidentId),
        eq(scoutAlertIncidents.serverId, input.serverId),
        eq(scoutAlertIncidents.workspaceId, input.workspaceId),
      ),
    )
    .limit(1);
  if (!incident) throw notFound("Scout incident");
  const [workload] = incident.deployableId
    ? await database
        .select({ name: apps.name, kind: apps.kind })
        .from(apps)
        .where(
          and(
            eq(apps.id, incident.deployableId),
            eq(apps.workspaceId, input.workspaceId),
          ),
        )
        .limit(1)
    : [];
  const agent = await getMonitoringAgent(input.serverId, input.workspaceId);
  const { condition } = incident;
  const notes: string[] = [];
  // Restart windows require individual counter measurements, not minute rollups.
  const days = condition.metric === "restarts" ? 1 : agent.retentionDays;
  const start = new Date(
    Math.max(incident.openedAt.getTime(), now.getTime() - days * 86400_000),
  );
  if (start > incident.openedAt)
    notes.push(
      condition.metric === "restarts"
        ? "Restart history is available for the last 24 hours, while individual counter measurements are retained."
        : `Earlier measurements are outside this server’s ${agent.retentionDays}-day retention period.`,
    );
  const step = Math.max(
    30,
    Math.ceil((now.getTime() - start.getTime()) / 360 / 30_000) * 30,
  );
  const startAt = start.toISOString(),
    endAt = now.toISOString();
  const observations = incidentObservations(
    incident,
    start,
    now,
    step,
    agent.retentionDays,
    notes,
  );
  const extreme = condition.operator === "above" ? sql`max` : sql`min`;
  const unavailable = Boolean(incident.deployableId && !incident.environment);
  if (unavailable)
    notes.push(
      "The environment was not recorded for this older incident; its chart is unavailable.",
    );
  const rows = unavailable
    ? []
    : await database.execute<{ bin: number; value: number | null }>(sql`
    with observations as (${observations}) select floor(extract(epoch from at-${startAt}::timestamptz)/${step})::integer bin,
      ${condition.metric === "httpAvailability" ? sql`max` : extreme}(value) value
    from observations where at>=${startAt}::timestamptz and at<=${endAt}::timestamptz
    group by bin order by bin limit 361`);
  const values = new Map(
    rows.map((row) => [
      Number(row.bin),
      row.value === null ? null : Number(row.value),
    ]),
  );
  const points = Array.from(
    {
      length: Math.min(
        361,
        Math.floor((now.getTime() - start.getTime()) / step / 1000) + 1,
      ),
    },
    (_, index) => ({
      at: new Date(start.getTime() + index * step * 1000).toISOString(),
      value: values.get(index) ?? null,
    }),
  );
  return {
    incident,
    entity: {
      id: incident.deployableId ?? input.serverId,
      name:
        workload?.name ??
        (incident.deployableId ? "Removed workload" : server.canonicalIp),
      kind: workload?.kind ?? (incident.deployableId ? "workload" : "server"),
    },
    history: {
      startAt,
      endAt,
      stepSeconds: step,
      points,
      notes,
      aggregation:
        condition.metric === "httpAvailability" ||
        condition.operator === "above"
          ? ("maximum" as const)
          : ("minimum" as const),
    },
  };
}

function incidentObservations(
  incident: typeof scoutAlertIncidents.$inferSelect,
  start: Date,
  now: Date,
  step: number,
  retentionDays: number,
  notes: string[],
): SQL {
  const { condition } = incident;
  const startAt = start.toISOString(),
    endAt = now.toISOString();
  const scope = incident.deployableId
    ? sql`deployable_id=${incident.deployableId}::uuid and ${incident.environment === "production" ? sql`preview_id is null` : sql`preview_id is not null`}`
    : condition.metric === "restarts"
      ? sql`entity_id<>'host'`
      : sql`entity_id='host'`;
  const filter = sql`server_id=${incident.serverId}::uuid and bucket_at>=${new Date(start.getTime() - (condition.metric === "restarts" ? condition.windowSeconds + 90 : 0) * 1000).toISOString()}::timestamptz and bucket_at<=${endAt}::timestamptz and ${scope}`;
  const extreme = condition.operator === "above" ? sql`max` : sql`min`;
  let observations: SQL;
  if (condition.metric === "httpAvailability") {
    observations = sql`select coalesce(checked_at,scheduled_at) at,
      case when state='healthy' then 0 when state='failed' then 1 else null end::double precision value
      from towbar_scout_http_checks where rule_id=${incident.ruleId}::uuid
      and date_trunc('milliseconds',rule_revision)=${incident.ruleRevision?.toISOString() ?? null}::timestamptz
      and scheduled_at>=${startAt}::timestamptz and coalesce(checked_at,scheduled_at)<=${endAt}::timestamptz`;
    if (!incident.ruleRevision)
      notes.push(
        "The original HTTP check configuration was not recorded for this older incident; its chart is unavailable.",
      );
  } else if (condition.metric === "missingReports") {
    // Bucket timestamps approximate report times to their retained 30/60-second resolution.
    observations = sql`select t at,extract(epoch from t-last_report)::double precision value from
      generate_series(${startAt}::timestamptz,${endAt}::timestamptz,${step}*interval '1 second') t
      left join lateral (select max(bucket_at) last_report from towbar_monitoring_samples
        where server_id=${incident.serverId}::uuid and entity_id='host'
        and bucket_at>=${new Date(now.getTime() - retentionDays * 86400_000).toISOString()}::timestamptz and bucket_at<=t) r on true`;
    notes.push(
      "Report age is estimated from retained report timestamps; periods without an earlier retained report have no measurement.",
    );
  } else if (condition.metric === "restarts") {
    observations = sql`with counters as (
      select entity_id,bucket_at,(metrics->'restartCount'->>'max')::double precision value,
        lag((metrics->'restartCount'->>'max')::double precision) over(partition by entity_id order by bucket_at) previous,
        lag(bucket_at) over(partition by entity_id order by bucket_at) previous_at
      from towbar_monitoring_samples where ${filter} and resolution=30
    ), deltas as (
      select bucket_at,sum(greatest(0,value-previous)) value,
        bool_and(value is not null and previous is not null and bucket_at-previous_at<=interval '90 seconds') complete
      from counters group by bucket_at
    ), windows as (
      select bucket_at,sum(value) over w value,count(*) over w samples,bool_and(complete) over w complete
      from deltas window w as(order by bucket_at range between (${condition.windowSeconds}*interval '1 second'-interval '1 millisecond') preceding and current row)
    ) select bucket_at at,case when complete and samples*30>=${condition.windowSeconds} then value else null end value from windows`;
  } else {
    observations = sql`select bucket_at at,case when bool_and(coalesce((metrics->${condition.metric}->>'count')::integer,0)>0) then ${extreme}(
      ${condition.aggregation === "peak" ? sql`(metrics->${condition.metric}->>'max')::double precision` : sql`(metrics->${condition.metric}->>'sum')::double precision/nullif((metrics->${condition.metric}->>'count')::integer,0)`}
      ) else null end value from towbar_monitoring_samples where ${filter} group by bucket_at`;
  }
  return observations;
}
