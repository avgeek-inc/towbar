import assert from "node:assert/strict";
import { test } from "node:test";
import { monitoringChartGaps } from "./monitoring-chart-gaps";

test("bridges bounded gaps, preserving zero readings and input data", () => {
  const rows = [
    { at: 0 },
    { at: 1, cpu: 0 },
    { at: 2, cpu: null },
    { at: 3 },
    { at: 4, cpu: 8 },
    { at: 5, cpu: 9 },
    { at: 6 },
  ];
  const original = structuredClone(rows);
  assert.deepEqual(monitoringChartGaps(rows, "cpu"), [
    [
      { x: 1, y: 0 },
      { x: 4, y: 8 },
    ],
  ]);
  assert.deepEqual(rows, original);
});

test("does not join different instances or extrapolate missing history", () => {
  const rows = [{ at: 0, first: 1 }, { at: 1 }, { at: 2, second: 2 }];
  assert.deepEqual(monitoringChartGaps(rows, "first"), []);
  assert.deepEqual(monitoringChartGaps(rows, "second"), []);
  assert.deepEqual(monitoringChartGaps(rows, "absent"), []);
});
