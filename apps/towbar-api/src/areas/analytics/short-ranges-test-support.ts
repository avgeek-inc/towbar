import assert from "node:assert/strict";

export async function verifyReportRanges({
  appId,
  workspaceId,
  report,
  service,
}: {
  appId: string;
  workspaceId: string;
  report: Awaited<
    ReturnType<(typeof import("./service.js"))["getAnalyticsReport"]>
  >;
  service: typeof import("./service.js");
}) {
  assert.equal(report.total, 2);
  assert.equal(report.errors, 2);
  assert.equal(report.meanMs, 10);
  assert.equal(report.p95Ms, 10);
  assert.equal(report.dimensions.path?.[0]?.value, "/docs");
  assert.equal(
    report.comparison,
    null,
    "previous period exceeds configured retention",
  );
  for (const [days, buckets] of [
    [1 / 96, 15],
    [1 / 24, 30],
    [1 / 8, 18],
    [1 / 2, 24],
  ] as const) {
    const report = await service.getAnalyticsReport({
      appId,
      workspaceId,
      days,
      kind: "request",
    });
    assert.equal(report.total, 2);
    assert.equal(report.trend.length, buckets);
  }
  const filterOptions = await service.getAnalyticsFilterOptions({
    appId,
    workspaceId,
    days: 1 / 96,
    kind: "request",
    field: "status",
    search: "50",
  });
  assert.deepEqual(filterOptions, ["503"]);
}
