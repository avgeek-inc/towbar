import assert from "node:assert/strict";
import test from "node:test";
import { aggregateMonitoringValues } from "./monitoring.js";
import {
  evaluateScoutCondition,
  scoutAlertPresets,
  scoutAlertRuleSchema,
  scoutGaugeObservations,
  scoutRestartObservations,
} from "./scout-alerts.js";

const condition = scoutAlertPresets.find((p) => p.id === "memory")!.condition;
const now = Date.parse("2026-09-06T12:00:00Z");
const observations = (value: number) =>
  Array.from({ length: 11 }, (_, i) => ({
    at: now - (10 - i) * 30_000,
    value,
  }));

void test("fires only after sustained observations, not elapsed wall time", () => {
  assert.equal(
    evaluateScoutCondition(condition, observations(91), now, false).state,
    "firing",
  );
  assert.equal(
    evaluateScoutCondition(
      condition,
      observations(91).slice(1),
      now + 30_000,
      false,
    ).state,
    "pending",
  );
  assert.equal(
    evaluateScoutCondition(condition, [{ at: now, value: 99 }], now, false)
      .state,
    "pending",
  );
  assert.equal(
    evaluateScoutCondition(condition, observations(89), now, false).state,
    "healthy",
  );
});
void test("missing or stale measurements never resolve an active incident", () => {
  assert.equal(
    evaluateScoutCondition(condition, observations(0), now + 91_000, true)
      .state,
    "unknown",
  );
  assert.equal(
    evaluateScoutCondition(condition, [{ at: now, value: null }], now, true)
      .state,
    "unknown",
  );
  assert.equal(
    evaluateScoutCondition(
      condition,
      [{ at: now + 30_000, value: 0 }],
      now,
      true,
    ).state,
    "unknown",
  );
});
void test("uses recovery hysteresis and waits for sustained recovery", () => {
  assert.equal(
    evaluateScoutCondition(condition, observations(88), now, true).state,
    "firing",
  );
  assert.equal(
    evaluateScoutCondition(condition, observations(85).slice(-4), now, true)
      .state,
    "pending",
  );
  assert.equal(
    evaluateScoutCondition(condition, observations(85).slice(-5), now, true)
      .state,
    "healthy",
  );
});
void test("a blackout or healthy sample breaks the pending duration", () => {
  const gap = observations(99).filter((_, i) => i < 3 || i > 6);
  assert.equal(
    evaluateScoutCondition(condition, gap, now, false).state,
    "pending",
  );
  const healthy = observations(99);
  healthy[5]!.value = 20;
  assert.equal(
    evaluateScoutCondition(condition, healthy, now, false).state,
    "pending",
  );
});
void test("sorts and deduplicates samples without counting retries toward duration", () => {
  const points = observations(99);
  assert.equal(
    evaluateScoutCondition(
      condition,
      [...points, ...points].reverse(),
      now,
      false,
    ).state,
    "firing",
  );
  assert.equal(
    evaluateScoutCondition(
      condition,
      Array(20).fill({ at: now, value: 99 }),
      now,
      false,
    ).state,
    "pending",
  );
});
void test("counts restarts within the window but not counter resets or replacement identities", () => {
  const samples = [0, 1, 3, 0, 1].map((restartCount, i) => ({
    entityId: "a",
    at: now + i * 30_000,
    metrics: aggregateMonitoringValues({ restartCount }),
  }));
  samples.push({
    entityId: "b",
    at: now + 120_000,
    metrics: aggregateMonitoringValues({ restartCount: 100 }),
  });
  assert.deepEqual(
    scoutRestartObservations(samples, 60).map((v) => v.value),
    [1, 3, 2, 1],
  );
});
void test("does not turn restart counter changes across a blackout into current events", () => {
  assert.deepEqual(
    scoutRestartObservations(
      [
        {
          entityId: "a",
          at: now - 600_000,
          metrics: aggregateMonitoringValues({ restartCount: 0 }),
        },
        {
          entityId: "a",
          at: now,
          metrics: aggregateMonitoringValues({ restartCount: 50 }),
        },
      ],
      300,
    ),
    [],
  );
});
void test("gauge observations preserve absent metrics and worst-instance semantics", () => {
  const points = scoutGaugeObservations(
    [
      {
        entityId: "a",
        at: now,
        metrics: aggregateMonitoringValues({ memoryPercent: 60 }),
      },
      {
        entityId: "b",
        at: now,
        metrics: aggregateMonitoringValues({ memoryPercent: 80 }),
      },
      { entityId: "a", at: now + 30_000, metrics: {} },
    ],
    condition,
  );
  assert.deepEqual(points, [
    { at: now, value: 80 },
    { at: now + 30_000, value: null },
  ]);
});
void test("rejects contradictory recovery and unsafe or redundant configuration", () => {
  const rule = { name: "Memory", condition };
  assert(scoutAlertRuleSchema.safeParse(rule).success);
  assert(
    !scoutAlertRuleSchema.safeParse({
      ...rule,
      condition: { ...condition, recoveryThreshold: 95 },
    }).success,
  );
  assert(
    !scoutAlertRuleSchema.safeParse({ ...rule, repeatSeconds: 1 }).success,
  );
  assert(
    !scoutAlertRuleSchema.safeParse({
      ...rule,
      condition: { ...condition, durationSeconds: 86400 },
    }).success,
  );
  assert(
    !scoutAlertRuleSchema.safeParse({
      ...rule,
      condition: { ...condition, threshold: Infinity },
    }).success,
  );
  assert(
    !scoutAlertRuleSchema.safeParse({
      ...rule,
      destinationIds: Array(2).fill("11111111-1111-4111-8111-111111111111"),
    }).success,
  );
});
