import { and, asc, eq, isNull, lte, or, sql } from "drizzle-orm";
import {
  type ScoutObservation,
  evaluateScoutCondition,
  scoutAlertConditionSchema,
} from "@workspace/towbar-core";
import {
  apps,
  monitoringAgents,
  monitoringSamples,
  notificationDeliveries,
  notificationDestinations,
  notificationEvents,
  scoutAlertIncidents,
  scoutAlertRules,
  scoutAlertSettings,
  scoutHttpChecks,
  servers,
  sources,
} from "@workspace/towbar-database/schema";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import { getEnv } from "../../env.js";
import { enqueueDeliveries } from "../notifications/delivery-service.js";
import { type ScoutTransaction, resolveRuleIncidents } from "./alert-rules.js";

/** Bounded, oldest-first work selection. A rule lock makes concurrent sweeps idempotent. */
export async function evaluateScoutAlerts(
  now = new Date(),
  enqueue = enqueueDeliveries,
) {
  const db = getTowbarDatabase();
  const due = new Date(now.getTime() - 30_000);
  const candidates = await db
    .select({ id: scoutAlertRules.id, serverId: scoutAlertRules.serverId })
    .from(scoutAlertRules)
    .where(
      and(
        eq(scoutAlertRules.enabled, true),
        isNull(scoutAlertRules.deletedAt),
        or(
          isNull(scoutAlertRules.evaluatedAt),
          lte(scoutAlertRules.evaluatedAt, due),
        ),
      ),
    )
    .orderBy(
      sql`${scoutAlertRules.evaluatedAt} asc nulls first`,
      asc(scoutAlertRules.id),
    )
    .limit(100);
  let evaluated = 0,
    errors = 0,
    visited = 0;
  const deadline = Date.now() + 40_000;
  for (const candidate of candidates) {
    if (Date.now() >= deadline) break;
    visited++;
    try {
      const deliveries = await db.transaction(async (tx) => {
        await tx.execute(sql`set local statement_timeout = '4000ms'`);
        await tx.execute(sql`set local lock_timeout = '1000ms'`);
        const [server] = await tx
          .select()
          .from(servers)
          .where(eq(servers.id, candidate.serverId))
          .for("share")
          .limit(1);
        const [rule] = await tx
          .select()
          .from(scoutAlertRules)
          .where(
            and(
              eq(scoutAlertRules.id, candidate.id),
              eq(scoutAlertRules.enabled, true),
              isNull(scoutAlertRules.deletedAt),
              or(
                isNull(scoutAlertRules.evaluatedAt),
                lte(scoutAlertRules.evaluatedAt, due),
              ),
            ),
          )
          .for("update", { skipLocked: true })
          .limit(1);
        if (!rule) return [];
        scoutAlertConditionSchema.parse(rule.condition);
        evaluated++;
        const [agent] = await tx
          .select()
          .from(monitoringAgents)
          .where(eq(monitoringAgents.serverId, rule.serverId))
          .limit(1);
        const [workload] = rule.deployableId
          ? await tx
              .select({
                id: apps.id,
                name: apps.name,
                kind: apps.kind,
                sourceId: apps.sourceId,
                serverId: apps.serverId,
                archivedAt: apps.archivedAt,
              })
              .from(apps)
              .where(
                and(
                  eq(apps.id, rule.deployableId),
                  eq(apps.workspaceId, rule.workspaceId),
                ),
              )
              .limit(1)
          : [];
        if (
          !server ||
          server.archivedAt ||
          server.workspaceId !== rule.workspaceId ||
          (rule.condition.metric !== "httpAvailability" &&
            (!agent || agent.desiredState !== "enabled")) ||
          (rule.deployableId &&
            (!workload ||
              workload.archivedAt ||
              workload.serverId !== server.id))
        ) {
          await resolveRuleIncidents(tx, rule.id, "monitoring_inactive", now);
          await tx
            .update(scoutAlertRules)
            .set({
              evaluatedAt: now,
              evaluationState: "inactive",
              observedValue: null,
            })
            .where(eq(scoutAlertRules.id, rule.id));
          return [];
        }
        const [active] = await tx
          .select()
          .from(scoutAlertIncidents)
          .where(
            and(
              eq(scoutAlertIncidents.ruleId, rule.id),
              isNull(scoutAlertIncidents.resolvedAt),
            ),
          )
          .limit(1);
        const observations = await getRuleObservations(
          tx,
          rule,
          agent,
          Boolean(active),
          now,
        );
        const result = evaluateScoutCondition(
          rule.condition,
          observations,
          now.getTime(),
        );
        return applyRuleResult(
          tx,
          rule,
          active,
          { server, workload },
          result,
          now,
        );
      });
      await enqueue(deliveries);
    } catch {
      errors++;
      // Skip one bad rule without starving later rules. Delivery intents remain in the durable outbox.
      await db
        .transaction(async (tx) => {
          await tx.execute(sql`set local statement_timeout = '1500ms'`);
          await tx.execute(sql`set local lock_timeout = '500ms'`);
          await tx
            .update(scoutAlertRules)
            .set({
              evaluatedAt: now,
              evaluationState: "error",
              observedValue: null,
            })
            .where(
              and(
                eq(scoutAlertRules.id, candidate.id),
                isNull(scoutAlertRules.deletedAt),
                eq(scoutAlertRules.enabled, true),
              ),
            );
        })
        .catch(() => undefined);
    }
  }
  return {
    evaluated,
    errors,
    more: candidates.length === 100 || visited < candidates.length,
  };
}

async function queueScoutNotification(
  tx: ScoutTransaction,
  rule: typeof scoutAlertRules.$inferSelect,
  incident: typeof scoutAlertIncidents.$inferSelect,
  context: {
    server: typeof servers.$inferSelect;
    workload:
      { id: string; name: string; kind: string; sourceId: string } | undefined;
  },
  type: "scout.firing" | "scout.recovered",
  now: Date,
) {
  const destinations = await tx
    .select({ id: notificationDestinations.id })
    .from(notificationDestinations)
    .where(
      and(
        eq(notificationDestinations.workspaceId, rule.workspaceId),
        isNull(notificationDestinations.deletedAt),
        eq(notificationDestinations.serverId, rule.serverId),
      ),
    );
  if (!destinations.length) return [];
  let eligible = destinations;
  if (type === "scout.recovered") {
    const sent = await tx.execute<{ destination_id: string }>(sql`
      select distinct d.destination_id from towbar_notification_deliveries d join towbar_notification_events e on e.id=d.event_id
      where e.workspace_id=${rule.workspaceId}::uuid and e.payload->'details'->>'incidentId'=${incident.id}
        and e.type in ('scout.firing','scout.reminder') and d.state='succeeded'`);
    const ids = new Set(sent.map((row) => row.destination_id));
    eligible = destinations.filter((destination) => ids.has(destination.id));
    if (!eligible.length) return [];
  }
  const [source] = context.workload
    ? await tx
        .select({ id: sources.id, name: sources.repositoryName })
        .from(sources)
        .where(eq(sources.id, context.workload.sourceId))
        .limit(1)
    : [];
  const target = context.workload
    ? `${context.workload.kind === "app" ? "apps" : "resources"}/${context.workload.id}`
    : `servers/${rule.serverId}`;
  const sequence = incident.notificationSequence + 1;
  const status = type === "scout.recovered" ? "Recovered" : "Alert";
  const [event] = await tx
    .insert(notificationEvents)
    .values({
      workspaceId: rule.workspaceId,
      sourceId: null,
      serverId: rule.serverId,
      category: "scout",
      type,
      dedupeKey: `scout:${incident.id}:${sequence}`,
      occurredAt: now,
      payload: {
        title: `${status}: ${rule.name}`,
        message: `${rule.name} ${type === "scout.recovered" ? "has recovered" : "needs attention"} on ${context.workload?.name ?? context.server.canonicalIp}.`,
        occurredAt: now.toISOString(),
        source: source ?? null,
        entity: {
          id: context.workload?.id ?? rule.serverId,
          kind: context.workload
            ? context.workload.kind === "app"
              ? "app"
              : "resource"
            : "server",
          name: context.workload?.name ?? context.server.canonicalIp,
        },
        details: {
          incidentId: incident.id,
          ruleId: rule.id,
          severity: rule.severity,
          environment: rule.environment,
          metric: rule.condition.metric,
          threshold: rule.condition.threshold,
          value: incident.lastValue,
          performance: new URL(
            `/${target}?section=monitoring`,
            getEnv().TOWBAR_APP_BASE_URL,
          ).toString(),
        },
      },
    })
    .onConflictDoNothing()
    .returning({ id: notificationEvents.id });
  if (!event) return [];
  const deliveries = await tx
    .insert(notificationDeliveries)
    .values(
      eligible.map((destination) => ({
        destinationId: destination.id,
        eventId: event.id,
      })),
    )
    .onConflictDoNothing()
    .returning({
      id: notificationDeliveries.id,
      cycle: notificationDeliveries.cycle,
    });
  await tx
    .update(scoutAlertIncidents)
    .set({ notificationSequence: sequence, lastNotifiedAt: now })
    .where(eq(scoutAlertIncidents.id, incident.id));
  return deliveries;
}

async function getRuleObservations(
  tx: ScoutTransaction,
  rule: typeof scoutAlertRules.$inferSelect,
  agent: typeof monitoringAgents.$inferSelect | undefined,
  active: boolean,
  now: Date,
): Promise<ScoutObservation[]> {
  const condition = rule.condition;
  let observations: ScoutObservation[] = [];
  if (condition.metric === "httpAvailability") {
    const checks = await tx
      .select()
      .from(scoutHttpChecks)
      .where(
        and(
          eq(scoutHttpChecks.ruleId, rule.id),
          sql`date_trunc('milliseconds',${scoutHttpChecks.ruleRevision})=${rule.updatedAt.toISOString()}::timestamptz`,
          sql`${scoutHttpChecks.scheduledAt} >= ${new Date(now.getTime() - 2 * condition.http!.intervalSeconds * 1000).toISOString()}::timestamptz`,
          lte(scoutHttpChecks.scheduledAt, now),
        ),
      )
      .orderBy(asc(scoutHttpChecks.scheduledAt))
      .limit(245);
    return checks.map((check) => ({
      at: (check.checkedAt ?? check.scheduledAt).getTime(),
      value:
        check.state === "healthy" ? 0 : check.state === "failed" ? 1 : null,
    }));
  } else if (condition.metric === "missingReports" && agent) {
    // Installation is given time to produce its first valid report.
    const last =
      agent.lastCollectedAt?.getTime() ??
      Math.max(
        agent.updatedAt.getTime(),
        agent.operationStartedAt?.getTime() ?? 0,
      ) + 300_000;
    if (["online", "waiting"].includes(agent.status)) {
      observations = [
        {
          at: now.getTime(),
          value: now.getTime() < last ? null : (now.getTime() - last) / 1000,
        },
      ];
      if (
        active &&
        agent.lastCollectedAt &&
        now.getTime() - agent.lastCollectedAt.getTime() <= 90_000
      ) {
        const samples = await tx
          .select({ at: monitoringSamples.bucketAt })
          .from(monitoringSamples)
          .where(
            and(
              eq(monitoringSamples.serverId, rule.serverId),
              eq(monitoringSamples.entityId, "host"),
              sql`${monitoringSamples.bucketAt} >= ${new Date(now.getTime() - 120 * 1000).toISOString()}::timestamptz`,
              lte(monitoringSamples.bucketAt, now),
            ),
          )
          .orderBy(asc(monitoringSamples.bucketAt))
          .limit(130);
        observations = samples.map((sample) => ({
          at: sample.at.getTime(),
          value: 0,
        }));
      }
    }
  } else if (condition.metric !== "missingReports") {
    const historySeconds =
      (condition.metric === "restarts" ? condition.windowSeconds : 0) + 120;
    const scope = rule.deployableId
      ? sql`${monitoringSamples.deployableId}=${rule.deployableId}::uuid and ${rule.environment === "production" ? sql`${monitoringSamples.previewId} is null` : sql`${monitoringSamples.previewId} is not null`}`
      : condition.metric === "restarts"
        ? sql`${monitoringSamples.entityId}<>'host'`
        : sql`${monitoringSamples.entityId}='host'`;
    const filter = sql`server_id=${rule.serverId}::uuid and bucket_at>=${new Date(now.getTime() - historySeconds * 1000).toISOString()}::timestamptz and bucket_at<=${now.toISOString()}::timestamptz and ${scope}`;
    const rows =
      condition.metric === "restarts"
        ? await tx.execute<{ at: string; value: number | null }>(sql`
              with counters as (
                select entity_id,bucket_at,(metrics->'restartCount'->>'max')::double precision value,
                  lag((metrics->'restartCount'->>'max')::double precision) over(partition by entity_id order by bucket_at) previous,
                  lag(bucket_at) over(partition by entity_id order by bucket_at) previous_at
                from towbar_monitoring_samples where ${filter}
              ), deltas as (
                select bucket_at,sum(case when bucket_at-previous_at<=interval '90 seconds' then greatest(0,value-previous) else 0 end) value,
                  bool_and(value is not null and previous is not null and bucket_at-previous_at<=interval '90 seconds') complete
                from counters group by bucket_at
              ), windows as (
                select bucket_at,sum(value) over w value,count(*) over w samples,bool_and(complete) over w complete
                from deltas window w as(order by bucket_at range between (${condition.windowSeconds}*interval '1 second'-interval '1 millisecond') preceding and current row)
              ) select bucket_at::text at,case when complete and samples*30>=${condition.windowSeconds} then value else null end value
              from windows order by bucket_at limit 245`)
        : await tx.execute<{ at: string; value: number | null }>(sql`
              select bucket_at::text at,case when bool_and(coalesce((metrics->${condition.metric}->>'count')::integer,0)>0) then ${condition.operator === "above" ? sql`max` : sql`min`}(
                ${condition.aggregation === "peak" ? sql`(metrics->${condition.metric}->>'max')::double precision` : sql`(metrics->${condition.metric}->>'sum')::double precision/nullif((metrics->${condition.metric}->>'count')::integer,0)`}
              ) else null end value from towbar_monitoring_samples where ${filter} group by bucket_at order by bucket_at limit 245`);
    observations = rows.map((row) => ({
      at: new Date(row.at).getTime(),
      value: row.value === null ? null : Number(row.value),
    }));
  }

  return observations;
}

async function applyRuleResult(
  tx: ScoutTransaction,
  rule: typeof scoutAlertRules.$inferSelect,
  active: typeof scoutAlertIncidents.$inferSelect | undefined,
  context: Parameters<typeof queueScoutNotification>[3],
  result: ReturnType<typeof evaluateScoutCondition>,
  now: Date,
) {
  await tx
    .update(scoutAlertRules)
    .set({
      evaluatedAt: now,
      evaluationState: result.state,
      observedValue: result.value,
    })
    .where(eq(scoutAlertRules.id, rule.id));
  const [settings] = await tx
    .select()
    .from(scoutAlertSettings)
    .where(eq(scoutAlertSettings.serverId, rule.serverId))
    .limit(1);
  const muted = Boolean(
    (rule.mutedUntil && rule.mutedUntil > now) ||
    (settings?.mutedUntil && settings.mutedUntil > now),
  );
  if (active) {
    await tx
      .update(scoutAlertIncidents)
      .set({ lastValue: result.value })
      .where(eq(scoutAlertIncidents.id, active.id));
    if (result.state === "healthy") {
      await resolveRuleIncidents(tx, rule.id, "recovered", now);
      if (!muted && rule.notifyRecovery && active.lastNotifiedAt)
        return queueScoutNotification(
          tx,
          rule,
          { ...active, lastValue: result.value },
          context,
          "scout.recovered",
          now,
        );
    } else if (result.state === "firing" && !muted && !active.lastNotifiedAt) {
      return queueScoutNotification(
        tx,
        rule,
        { ...active, lastValue: result.value },
        context,
        "scout.firing",
        now,
      );
    }
  } else if (result.state === "firing") {
    const [incident] = await tx
      .insert(scoutAlertIncidents)
      .values({
        ruleId: rule.id,
        ruleName: rule.name,
        workspaceId: rule.workspaceId,
        serverId: rule.serverId,
        deployableId: rule.deployableId,
        severity: rule.severity,
        condition: rule.condition,
        openedAt: now,
        conditionStartedAt: new Date(result.since ?? now.getTime()),
        lastValue: result.value,
      })
      .returning();
    if (incident && !muted)
      return queueScoutNotification(
        tx,
        rule,
        incident,
        context,
        "scout.firing",
        now,
      );
  }
  return [];
}
