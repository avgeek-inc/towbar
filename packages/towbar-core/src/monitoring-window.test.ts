import assert from "node:assert/strict";
import test from "node:test";
import {
  monitoringQuerySchema,
  resolveMonitoringWindow,
} from "./monitoring.js";
const now = new Date("2026-09-07T12:00:00Z");
void test("short presets and custom windows share bounded resolution", () => {
  for (const [range, seconds] of [
    ["15m", 900],
    ["30m", 1800],
  ] as const) {
    const window = resolveMonitoringWindow(
      monitoringQuerySchema.parse({ range }),
      15,
      now,
    );
    assert.equal(now.getTime() - window.start.getTime(), seconds * 1000);
    assert.equal(window.step, 30);
  }
  const window = resolveMonitoringWindow(
    {
      range: "custom",
      startAt: "2026-09-07T15:30:00+05:30",
      endAt: "2026-09-07T16:00:00+05:30",
    },
    15,
    now,
  );
  assert.equal(window.start.toISOString(), "2026-09-07T10:00:00.000Z");
  assert.equal(window.end.toISOString(), "2026-09-07T10:30:00.000Z");
  const long = resolveMonitoringWindow(
    {
      range: "custom",
      startAt: "2026-07-09T12:00:00Z",
      endAt: now.toISOString(),
    },
    60,
    now,
  );
  assert.ok(
    (long.end.getTime() - long.start.getTime()) / 1000 / long.step <= 360,
  );
});
void test("custom windows reject incomplete, reversed, tiny, future and expired ranges", () => {
  for (const input of [
    { range: "custom" },
    { range: "custom", startAt: "invalid", endAt: now.toISOString() },
    {
      range: "custom",
      startAt: now.toISOString(),
      endAt: "2026-09-07T11:00:00Z",
    },
    {
      range: "custom",
      startAt: "2026-09-07T11:59:45Z",
      endAt: now.toISOString(),
    },
    {
      range: "custom",
      startAt: now.toISOString(),
      endAt: "2026-09-07T13:00:00Z",
    },
    {
      range: "custom",
      startAt: "2026-08-01T12:00:00Z",
      endAt: now.toISOString(),
    },
    { range: "1h", startAt: "2026-09-07T11:00:00Z" },
  ] as const)
    assert.throws(() => resolveMonitoringWindow(input, 15, now));
});

void test("short historical custom windows use retained one-minute rollups", () => {
  const window = resolveMonitoringWindow(
    {
      range: "custom",
      startAt: "2026-09-05T10:00:00Z",
      endAt: "2026-09-05T10:15:00Z",
    },
    15,
    now,
  );
  assert.equal(window.step, 60);
});
