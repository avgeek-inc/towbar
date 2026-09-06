import assert from "node:assert/strict";
import test from "node:test";
import {
  fixtureMonitoringAgent,
  fixtureMonitoringHistory,
} from "./monitoring-fixture.ts";

test("fixture histories and events stay inside the selected duration and retention", () => {
  for (const [range, seconds] of [
    ["15m", 900],
    ["30m", 1800],
    ["1h", 3600],
    ["6h", 21600],
    ["24h", 86400],
    ["7d", 604800],
    ["60d", 15 * 86400],
  ]) {
    const history = fixtureMonitoringHistory(
      fixtureMonitoringAgent(),
      "server",
      new URLSearchParams({ range }),
      false,
    );
    const duration = Date.parse(history.endAt) - Date.parse(history.startAt);
    assert(
      duration >= seconds * 1000 &&
        duration <= (seconds + history.stepSeconds) * 1000,
    );
    assert(
      history.series.every((series) =>
        series.points.every(
          (point) =>
            Date.parse(point.at) >=
              Date.parse(history.startAt) - history.stepSeconds * 1000 &&
            point.at < history.endAt,
        ),
      ),
    );
    assert(
      history.events.every(
        (event) => event.at >= history.startAt && event.at < history.endAt,
      ),
    );
    assert(history.series.every((series) => series.points.length <= 362));
  }
});

test("custom fixture range preserves exact times and bounds events", () => {
  const endAt = new Date(Date.now() - 3600000).toISOString();
  const startAt = new Date(Date.parse(endAt) - 900000).toISOString();
  const history = fixtureMonitoringHistory(
    fixtureMonitoringAgent(),
    "server",
    new URLSearchParams({ range: "custom", startAt, endAt }),
    true,
  );
  assert.equal(history.startAt, startAt);
  assert.equal(history.endAt, endAt);
  assert(
    history.events.every((event) => event.at >= startAt && event.at < endAt),
  );
});
