import { fixtureJson } from "./fixture-localization.ts";
import type { IncomingMessage, ServerResponse } from "node:http";
import { analyticsQuerySchema } from "@workspace/towbar-core";
import type { AnalyticsReport } from "@workspace/towbar-web-client";

export function analyticsFixture(
  _request: IncomingMessage,
  response: ServerResponse,
  url: URL,
) {
  if (!/^\/v1\/core\/apps\/[^/]+\/analytics$/u.test(url.pathname)) return false;
  const query = analyticsQuerySchema.safeParse(
    Object.fromEntries(url.searchParams),
  );
  if (!query.success) {
    response.writeHead(400, { "content-type": "application/json" });
    response.end(
      JSON.stringify({ error: { message: "Invalid analytics filters" } }),
    );
    return true;
  }
  const { kind, days, filters } = query.data;
  if (
    filters.length &&
    process.env.TOWBAR_FIXTURE_ANALYTICS_STATE === "filtered-error"
  ) {
    response.writeHead(503, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        error: { message: "Analytics is temporarily unavailable" },
      }),
    );
    return true;
  }
  const paths = [
    { value: "/", share: 0.45 },
    { value: "/docs/getting-started", share: 0.24 },
    { value: "/pricing", share: 0.12 },
    {
      value:
        "/blog/a-long-article-path-that-must-truncate-without-breaking-the-table",
      share: 0.05,
    },
    { value: "/docs/api", share: 0.09 },
    { value: "/contact", share: 0.05 },
  ];
  const matchingPaths = paths.filter((path) =>
    filters.every((filter) =>
      filter.operator === "equals"
        ? path.value === filter.value
        : path.value.startsWith(filter.value),
    ),
  );
  const fraction = matchingPaths.reduce((sum, path) => sum + path.share, 0);
  const end = Date.now();
  const allCounts = Array.from({ length: days === 1 ? 24 : days }, (_, i) =>
    kind === "request" ? 400 + ((i * 137) % 450) : 200 + ((i * 57) % 190),
  );
  const allocate = (count: number) =>
    paths
      .map((path, index) => ({
        value: path.value,
        count:
          index === 0
            ? count -
              paths
                .slice(1)
                .reduce(
                  (sum, other) => sum + Math.floor(count * other.share),
                  0,
                )
            : Math.floor(count * path.share),
      }))
      .filter((path) =>
        matchingPaths.some((match) => match.value === path.value),
      );
  const currentBuckets = allCounts.map(allocate);
  const counts = currentBuckets.map((rows) =>
    rows.reduce((sum, row) => sum + row.count, 0),
  );
  const previousCounts = allCounts.map((count, i) =>
    allocate(Math.floor(count * (0.65 + (i % 3) * 0.15))).reduce(
      (sum, row) => sum + row.count,
      0,
    ),
  );
  const total = counts.reduce((a, b) => a + b, 0);
  const histogram = [0, 0.55, 0.27, 0.12, 0.015, 0.005, 0.001, 0.0005].map(
    (share) => Math.floor(total * share),
  );
  histogram[0] = total - histogram.reduce((a, b) => a + b, 0);
  const share = (fraction: number) => Math.floor(total * fraction);
  const report: AnalyticsReport = {
    enabled: true,
    config: {
      enabled: true,
      pageviews: true,
      visitorIdentity: true,
      retentionDays: 90,
      excludePaths: [],
    },
    agentStatus: "online",
    lastReceivedAt: new Date().toISOString(),
    droppedSamples: 0,
    droppedEvents: 0,
    collectionReady: true,
    geolocationBuiltAt: new Date(end - 14 * 86400000).toISOString(),
    collectionErrors: 0,
    start: new Date(end - days * 86400000).toISOString(),
    end: new Date(end).toISOString(),
    kind,
    filters,
    total,
    bytes: Math.floor(23456789 * fraction),
    errors: Math.floor(34 * fraction),
    meanMs: total ? 48.2 : null,
    p50Ms: total ? 50 : null,
    p95Ms: total ? 200 : null,
    visitors: kind === "pageview" ? Math.floor(702 * fraction) : null,
    sessions: kind === "pageview" ? Math.floor(841 * fraction) : null,
    histogram,
    deployments: [0.7, 0.3].map((fraction, index) => ({
      id: `61111111-1111-4111-8111-${String(index + 1).padStart(12, "0")}`,
      at: new Date(end - days * 86400000 * fraction).toISOString(),
      state: index === 0 ? "succeeded" : "failed",
      type: "deployment",
    })),
    trend: counts.map((count, i) => ({
      at: new Date(
        end - (counts.length - i) * (days === 1 ? 3600000 : 86400000),
      ).toISOString(),
      count,
      errors: Math.floor((i % 3) * fraction),
    })),
    comparison:
      days * 2 > 90 || !fraction
        ? null
        : {
            start: new Date(end - 2 * days * 86400000).toISOString(),
            end: new Date(end - days * 86400000).toISOString(),
            total: previousCounts.reduce((sum, count) => sum + count, 0),
            errors: Math.floor(50 * fraction),
            meanMs: 56.8,
            visitors: kind === "pageview" ? Math.floor(640 * fraction) : null,
            sessions: kind === "pageview" ? Math.floor(910 * fraction) : null,
            trend: counts.map((_count, i) => ({
              at: new Date(
                end -
                  days * 86400000 -
                  (counts.length - i) * (days === 1 ? 3600000 : 86400000),
              ).toISOString(),
              count: previousCounts[i]!,
              errors: Math.floor(2 * fraction),
            })),
          },
    dimensions: {
      path: matchingPaths.map((path) => ({
        value: path.value,
        count: currentBuckets.reduce(
          (sum, rows) =>
            sum + (rows.find((row) => row.value === path.value)?.count ?? 0),
          0,
        ),
      })),
      referrer: [
        { value: "google.com", count: share(0.35) },
        { value: "github.com", count: share(0.2) },
        { value: "Unknown", count: total - share(0.35) - share(0.2) },
      ],
      ...(kind === "request"
        ? {
            status: [
              { value: "200", count: total - Math.floor(34 * fraction) },
              { value: "404", count: Math.floor(30 * fraction) },
              {
                value: "500",
                count: Math.floor(34 * fraction) - Math.floor(30 * fraction),
              },
            ],
            method: [
              { value: "GET", count: total - Math.floor(50 * fraction) },
              { value: "POST", count: Math.floor(50 * fraction) },
            ],
          }
        : {
            country: [
              { value: "IN", count: share(0.6) },
              { value: "US", count: share(0.25) },
              { value: "Unknown", count: total - share(0.6) - share(0.25) },
            ],
            browser: [
              { value: "Chrome", count: share(0.6) },
              { value: "Safari", count: share(0.3) },
            ],
            device: [
              { value: "Desktop", count: share(0.58) },
              { value: "Mobile", count: share(0.4) },
            ],
          }),
    },
  };
  if (!total || process.env.TOWBAR_FIXTURE_ANALYTICS_STATE === "empty") {
    report.total = 0;
    report.bytes = 0;
    report.errors = 0;
    report.meanMs = report.p50Ms = report.p95Ms = null;
    report.visitors = kind === "pageview" ? 0 : null;
    report.sessions = kind === "pageview" ? 0 : null;
    report.histogram = report.histogram.map(() => 0);
    report.trend = [];
    report.dimensions = Object.fromEntries(
      Object.keys(report.dimensions).map((key) => [key, []]),
    );
  }
  if (process.env.TOWBAR_FIXTURE_ANALYTICS_STATE === "disabled") {
    report.enabled = false;
    report.config = null;
  }
  response.writeHead(200, { "content-type": "application/json" });
  response.end(fixtureJson(response, report));
  return true;
}
