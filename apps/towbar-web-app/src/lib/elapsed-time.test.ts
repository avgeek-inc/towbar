import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatElapsedTime,
  isEventRunning,
  type TimedEvent,
} from "./elapsed-time";

const start = "2026-09-05T00:00:00Z";
const now = Date.parse(start) + 92_000;
const running: TimedEvent = {
  startedAt: start,
  finishedAt: null,
  status: "building",
};

void test("active events advance independently of API refreshes", () => {
  assert.equal(isEventRunning(running), true);
  assert.equal(formatElapsedTime(running, now), "1m 32s");
  assert.equal(formatElapsedTime(running, now + 1_000), "1m 33s");
  assert.equal(formatElapsedTime(running, now + 12_000), "1m 44s");
});
void test("terminal events stop at the recorded finish, even on a stale active status", () => {
  for (const status of [
    "succeeded",
    "succeeded_with_warnings",
    "skipped",
    "failed",
    "cancelled",
    "building",
  ]) {
    const event = {
      ...running,
      status,
      finishedAt: new Date(now).toISOString(),
    };
    assert.equal(isEventRunning(event), false);
    assert.equal(formatElapsedTime(event, now + 60_000), "1m 32s");
  }
});
void test("terminal events with missing end times never continue counting", () => {
  for (const status of [
    "succeeded",
    "succeeded_with_warnings",
    "skipped",
    "failed",
    "cancelled",
  ]) {
    const event = { ...running, status };
    assert.equal(isEventRunning(event), false);
    assert.equal(formatElapsedTime(event, now), "—");
  }
});
void test("long durations preserve seconds and roll over cleanly", () => {
  assert.equal(
    formatElapsedTime(running, Date.parse(start) + 86_399_000),
    "23h 59m 59s",
  );
  assert.equal(
    formatElapsedTime(running, Date.parse(start) + 86_400_000),
    "1d 0h 0m 0s",
  );
});
void test("queued, missing, malformed, and future timestamps are safe", () => {
  assert.equal(
    formatElapsedTime({ ...running, startedAt: null, status: "queued" }, now),
    "—",
  );
  assert.equal(isEventRunning({ ...running, startedAt: "invalid" }), false);
  assert.equal(
    formatElapsedTime({ ...running, finishedAt: "invalid" }, now),
    "—",
  );
  assert.equal(formatElapsedTime(running, Date.parse(start) - 1_000), "0s");
  assert.equal(formatElapsedTime(running, 0), "—");
});
