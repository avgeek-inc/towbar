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

void test("fires on the first qualifying reading and recovers at the opposite side of the threshold", () => {
  for (const operator of ["above", "below"] as const) {
    const rule = { ...condition, operator };
    const reading = (value: number) => [{ at: now, value }];
    assert.equal(
      evaluateScoutCondition(rule, reading(90), now).state,
      "firing",
    );
    assert.equal(
      evaluateScoutCondition(rule, reading(operator === "above" ? 89 : 91), now)
        .state,
      "healthy",
    );
    assert.equal(
      evaluateScoutCondition(rule, reading(operator === "above" ? 91 : 89), now)
        .state,
      "firing",
    );
  }
});
void test("missing, stale, and future measurements cannot trigger or prove recovery", () => {
  for (const points of [
    [],
    [{ at: now, value: null }],
    [{ at: now - 91_000, value: 0 }],
    [{ at: now + 30_000, value: 0 }],
  ]) {
    assert.equal(
      evaluateScoutCondition(condition, points, now).state,
      "unknown",
    );
  }
});
void test("uses the latest reading across blackouts, unordered history, and retries", () => {
  const points = [
    { at: now - 600_000, value: 1 },
    { at: now, value: 99 },
  ];
  assert.equal(
    evaluateScoutCondition(condition, [...points, ...points].reverse(), now)
      .state,
    "firing",
  );
  assert.equal(
    evaluateScoutCondition(
      condition,
      [...observations(99), { at: now, value: 89 }],
      now,
    ).state,
    "healthy",
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
    [null, null, 3, 2, null],
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
    [
      { at: now - 600_000, value: null },
      { at: now, value: null },
    ],
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
void test("rejects removed recovery, repeat, and destination controls and unsafe configuration", () => {
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

void test("a missing gauge in a reported container cannot prove recovery for the group", () => {
  assert.equal(
    scoutGaugeObservations(
      [
        {
          entityId: "a",
          at: now,
          metrics: aggregateMonitoringValues({ memoryPercent: 1 }),
        },
        { entityId: "b", at: now, metrics: {} },
      ],
      condition,
    )[0]?.value,
    null,
  );
});
