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

test("city filters apply consistently to pageview reports", () => {
  const all = report("pageview");
  const value = "Chennai, Tamil Nadu, IN";
  const filtered = report("pageview", [
    { field: "city", operator: "in", value: [value] },
  ]);
  assert.deepEqual(filtered.dimensions.city, [
    { value, count: filtered.total },
  ]);
  assert.equal(
    filtered.total,
    all.dimensions.city.find((row) => row.value === value).count,
  );
  assert.equal(
    filtered.trend.reduce((sum, row) => sum + row.count, 0),
    filtered.total,
  );
  assert.equal(report("request").dimensions.city, undefined);
});

test("HTTP dimension filters keep totals, errors and latency ranges consistent", () => {
  const selected = report("request", [
    { field: "status", operator: "in", value: ["404"] },
    { field: "method", operator: "in", value: ["POST"] },
    { field: "responseTime", operator: "in", value: ["50 to 100 ms"] },
  ]);
  assert(selected.total > 0);
  assert.deepEqual(selected.dimensions.status, [
    { value: "404", count: selected.total },
  ]);
  assert.deepEqual(selected.dimensions.method, [
    { value: "POST", count: selected.total },
  ]);
  assert.equal(selected.errors, selected.total);
  assert.equal(
    selected.trend.reduce((sum, point) => sum + point.errors, 0),
    selected.errors,
  );
  assert.equal(selected.comparison.errors, selected.comparison.total);
  assert.equal(selected.histogram[2], selected.total);
  assert.equal(
    selected.histogram.reduce((sum, count) => sum + count, 0),
    selected.total,
  );
});

test("web device and outbound filters preserve click totals and retain cities for expansion", () => {
  assert.equal(report("pageview").dimensions.city.length, 25);
  const selected = report("pageview", [
    { field: "device", operator: "in", value: ["Mobile"] },
    { field: "destination", operator: "in", value: ["github.com"] },
  ]);
  assert(selected.total > 0);
  assert.deepEqual(selected.dimensions.device, [
    { value: "Mobile", count: selected.total },
  ]);
  assert(selected.dimensions.city.length <= 25);
  assert.equal(selected.errors, 0);
  assert(selected.trend.every((point) => point.errors === 0));
  assert.deepEqual(selected.outboundLinks, [
    { value: "github.com", count: selected.outboundClicks },
  ]);
});
