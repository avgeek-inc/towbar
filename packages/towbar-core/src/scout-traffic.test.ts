import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateScoutCondition,
  scoutAlertRuleSchema,
  scoutTrafficObservation,
} from "./scout-alerts.js";
const appId = "11111111-1111-4111-8111-111111111111";
const rows = [0, 30, 60, 90].map((second) => ({
  at: second * 1000,
  count: second / 10,
  ready: true,
  dropped: 0,
}));
void test("traffic counts use a complete rolling window and treat actual zero as a reading", () => {
  assert.equal(scoutTrafficObservation(rows, 60, 90_000).value, 15);
  assert.equal(
    scoutTrafficObservation(
      rows.map((p) => ({ ...p, count: 0 })),
      60,
      90_000,
    ).value,
    0,
  );
  for (const metric of ["httpRequests", "pageviews"]) {
    const rule = scoutAlertRuleSchema.parse({
      name: "No traffic",
      deployableId: appId,
      condition: { metric, operator: "below", threshold: 0, windowSeconds: 60 },
    });
    assert.equal(
      evaluateScoutCondition(rule.condition, [{ at: 90_000, value: 0 }], 90_000)
        .state,
      "firing",
    );
    assert.equal(
      evaluateScoutCondition(rule.condition, [{ at: 90_000, value: 1 }], 90_000)
        .state,
      "healthy",
    );
    assert.equal(
      evaluateScoutCondition(
        rule.condition,
        [{ at: 90_000, value: null }],
        90_000,
      ).state,
      "unknown",
    );
    assert.equal(
      scoutAlertRuleSchema.safeParse({
        ...rule,
        condition: { ...rule.condition, windowSeconds: 61 },
      }).success,
      false,
    );
    assert.equal(
      scoutAlertRuleSchema.safeParse({ ...rule, deployableId: null }).success,
      false,
    );
    assert.equal(
      scoutAlertRuleSchema.safeParse({
        ...rule,
        condition: { ...rule.condition, threshold: 0.5 },
      }).success,
      false,
    );
    assert.equal(
      scoutAlertRuleSchema.safeParse({
        ...rule,
        condition: { ...rule.condition, durationSeconds: 60 },
      }).success,
      false,
    );
  }
});
void test("missing, old, unready, reset and dropped telemetry cannot prove zero traffic or recovery", () => {
  for (const samples of [
    [],
    rows.slice(2),
    rows.filter((p) => p.at !== 60_000),
    rows.map((p) => ({ ...p, ready: p.at !== 60_000 })),
    rows.map((p) => ({ ...p, dropped: p.at === 60_000 ? 1 : 0 })),
    rows.map((p) => ({ ...p, dropped: null })),
    [...rows, rows[3]!],
  ]) {
    assert.equal(scoutTrafficObservation(samples, 60, 90_000).value, null);
  }
  assert.equal(scoutTrafficObservation(rows, 60, 181_000).value, null);
  assert.equal(
    scoutTrafficObservation(
      rows.map((p) => ({ ...p, dropped: 10 })),
      60,
      90_000,
    ).value,
    15,
  );
});

void test("one-hour traffic windows count all intervals exactly once", () => {
  const hour = Array.from({ length: 121 }, (_, index) => ({
    at: index * 30_000,
    count: 2,
    ready: true,
    dropped: 0,
  }));
  assert.equal(scoutTrafficObservation(hour, 3600, 3600_000).value, 240);
});
