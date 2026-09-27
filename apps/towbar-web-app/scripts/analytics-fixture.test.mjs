import assert from "node:assert/strict";
import test from "node:test";
import { analyticsFixture } from "./analytics-fixture.ts";

function report(kind, filters = []) {
  let status, data;
  analyticsFixture(
    {},
    {
      writeHead(code) {
        status = code;
      },
      end(body) {
        data = JSON.parse(body);
      },
    },
    new URL(
      `http://fixture/v1/core/apps/test/analytics?${new URLSearchParams({ kind, days: "7", filters: JSON.stringify(filters) })}`,
    ),
  );
  assert.equal(status, 200);
  return data;
}
for (const kind of ["request", "pageview"]) {
  test(`analytics fixture filters ${kind} totals, paths, trend and comparison consistently`, (t) => {
    t.mock.timers.enable({
      apis: ["Date"],
      now: new Date("2026-09-27T12:00:00Z"),
    });
    const all = report(kind);
    const filters = [
      { field: "path", operator: "startsWith", value: "/docs/" },
    ];
    const filtered = report(kind, filters);
    assert.deepEqual(filtered.filters, filters);
    assert.deepEqual(filtered.deployments, all.deployments);
    assert(all.deployments.length > 0);
    assert(
      all.deployments.every(
        (event) =>
          event.type === "deployment" &&
          event.at >= all.start &&
          event.at < all.end,
      ),
    );
    assert.equal(
      filtered.total,
      all.dimensions.path
        .filter((row) => row.value.startsWith("/docs/"))
        .reduce((sum, row) => sum + row.count, 0),
    );
    assert.equal(
      filtered.trend.reduce((sum, point) => sum + point.count, 0),
      filtered.total,
    );
    assert.equal(
      filtered.comparison.trend.reduce((sum, point) => sum + point.count, 0),
      filtered.comparison.total,
    );
    assert(filtered.total < all.total);
    assert(filtered.comparison.total < all.comparison.total);
    assert(
      filtered.dimensions.path.every((row) => row.value.startsWith("/docs/")),
    );
    const exact = report(kind, [
      ...filters,
      { field: "path", operator: "equals", value: "/docs/api" },
    ]);
    assert.equal(
      exact.total,
      all.dimensions.path.find((row) => row.value === "/docs/api").count,
    );
    const empty = report(kind, [
      ...filters,
      { field: "path", operator: "equals", value: "/pricing" },
    ]);
    assert.equal(empty.total, 0);
    assert.equal(empty.comparison, null);
    assert(Object.values(empty.dimensions).every((rows) => rows.length === 0));
  });
}
