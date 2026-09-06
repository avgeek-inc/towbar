import assert from "node:assert/strict";
import test from "node:test";
import {
  fixtureMonitoringAgent,
  fixtureMonitoringHistory,
} from "./monitoring-fixture.ts";

test("fixture histories and events stay inside the selected duration and retention", () => {
  for (const [range, seconds] of [
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
    assert.equal(
      Date.parse(history.endAt) - Date.parse(history.startAt),
      seconds * 1000,
    );
    assert(
      history.series.every((series) =>
        series.points.every(
          (point) => point.at >= history.startAt && point.at < history.endAt,
        ),
      ),
    );
    assert(
      history.events.every(
        (event) => event.at >= history.startAt && event.at < history.endAt,
      ),
    );
    assert(history.series.every((series) => series.points.length <= 180));
  }
});
