import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { scoutTrafficObservation } from "@workspace/towbar-core";
import type { scoutAlertRules } from "@workspace/towbar-database/schema";
import { analyticsSamples } from "@workspace/towbar-database/schema";
import type { ScoutTransaction } from "./alert-rules.js";

export async function analyticsAlertObservations(
  tx: ScoutTransaction,
  rule: typeof scoutAlertRules.$inferSelect,
  now: Date,
) {
  if (!rule.deployableId) return [];
  const rows = await analyticsCountSamples(
    tx,
    rule,
    new Date(now.getTime() - (rule.condition.windowSeconds + 135) * 1000),
    now,
    126,
  );
  return [
    scoutTrafficObservation(rows, rule.condition.windowSeconds, now.getTime()),
  ];
}

async function analyticsCountSamples(
  tx: Pick<ScoutTransaction, "select">,
  rule: Pick<
    typeof scoutAlertRules.$inferSelect,
    "serverId" | "deployableId" | "condition"
  >,
  start: Date,
  now: Date,
  limit: number,
) {
  const kind = rule.condition.metric === "pageviews" ? "pageview" : "request";
  const rows = await tx
    .select({
      at: analyticsSamples.collectedAt,
      coverage: analyticsSamples.coverage,
      count: sql<number>`(select coalesce(sum((cell->>'count')::bigint),0)::float8
      from jsonb_array_elements(${analyticsSamples.cells}) cell where cell->>'kind'=${kind})`,
    })
    .from(analyticsSamples)
    .where(
      and(
        eq(analyticsSamples.appId, rule.deployableId!),
        eq(analyticsSamples.serverId, rule.serverId),
        gte(analyticsSamples.collectedAt, start),
        lte(analyticsSamples.collectedAt, now),
      ),
    )
    .orderBy(desc(analyticsSamples.collectedAt))
    .limit(limit);
  return rows.map((row) => ({
    at: row.at.getTime(),
    count: row.count,
    ready:
      kind === "pageview"
        ? row.coverage?.pageviews === true
        : row.coverage?.requests === true,
    dropped: row.coverage?.dropped ?? null,
  }));
}

export async function analyticsAlertHistory(
  database: Pick<ScoutTransaction, "select">,
  incident: Pick<
    typeof scoutAlertRules.$inferSelect,
    "serverId" | "deployableId" | "condition"
  >,
  start: Date,
  now: Date,
  step: number,
) {
  if (!incident.deployableId) return [];
  const samples = (
    await analyticsCountSamples(
      database,
      incident,
      new Date(
        start.getTime() - (incident.condition.windowSeconds + 45) * 1000,
      ),
      now,
      3010,
    )
  ).sort((a, b) => a.at - b.at);
  const bins = new Map<number, number | null>();
  for (let index = 0; index < samples.length; index++) {
    const sample = samples[index]!;
    if (sample.at < start.getTime()) continue;
    const point = scoutTrafficObservation(
      samples.slice(Math.max(0, index - 125), index + 1),
      incident.condition.windowSeconds,
      sample.at,
    );
    const bin = Math.floor((sample.at - start.getTime()) / (step * 1000));
    const old = bins.get(bin);
    if (point.value !== null)
      bins.set(
        bin,
        old == null
          ? point.value
          : incident.condition.operator === "above"
            ? Math.max(old, point.value)
            : Math.min(old, point.value),
      );
    else if (!bins.has(bin)) bins.set(bin, null);
  }
  return [...bins].map(([bin, value]) => ({ bin, value }));
}
