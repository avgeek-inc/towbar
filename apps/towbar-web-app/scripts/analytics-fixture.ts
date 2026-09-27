import type { IncomingMessage, ServerResponse } from "node:http";
import type { AnalyticsReport } from "@workspace/towbar-web-client";

export function analyticsFixture(
  _request: IncomingMessage,
  response: ServerResponse,
  url: URL,
) {
  if (!/^\/v1\/core\/apps\/[^/]+\/analytics$/u.test(url.pathname)) return false;
  const kind =
    url.searchParams.get("kind") === "pageview" ? "pageview" : "request";
  const days = Number(url.searchParams.get("days") ?? 7);
  const end = Date.now();
  const counts = Array.from({ length: days === 1 ? 24 : days }, (_, i) =>
    kind === "request" ? 400 + ((i * 137) % 450) : 200 + ((i * 57) % 190),
  );
  const previousCounts = counts.map((count, i) =>
    Math.floor(count * (0.65 + (i % 3) * 0.15)),
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
    total,
    bytes: 23456789,
    errors: 34,
    meanMs: 48.2,
    p50Ms: 50,
    p95Ms: 200,
    visitors: kind === "pageview" ? 702 : null,
    sessions: kind === "pageview" ? 841 : null,
    histogram,
    trend: counts.map((count, i) => ({
      at: new Date(
        end - (counts.length - i) * (days === 1 ? 3600000 : 86400000),
      ).toISOString(),
      count,
      errors: i % 3,
    })),
    comparison:
      days * 2 > 90
        ? null
        : {
            start: new Date(end - 2 * days * 86400000).toISOString(),
            end: new Date(end - days * 86400000).toISOString(),
            total: previousCounts.reduce((sum, count) => sum + count, 0),
            errors: 50,
            meanMs: 56.8,
            visitors: kind === "pageview" ? 640 : null,
            sessions: kind === "pageview" ? 910 : null,
            trend: counts.map((_count, i) => ({
              at: new Date(
                end -
                  days * 86400000 -
                  (counts.length - i) * (days === 1 ? 3600000 : 86400000),
              ).toISOString(),
              count: previousCounts[i]!,
              errors: 2,
            })),
          },
    dimensions: {
      path: [
        { value: "/", count: share(0.45) },
        { value: "/docs/getting-started", count: share(0.24) },
        { value: "/pricing", count: share(0.12) },
        {
          value:
            "/blog/a-long-article-path-that-must-truncate-without-breaking-the-table",
          count: share(0.05),
        },
      ],
      referrer: [
        { value: "google.com", count: share(0.35) },
        { value: "github.com", count: share(0.2) },
        { value: "Unknown", count: total - share(0.35) - share(0.2) },
      ],
      ...(kind === "request"
        ? {
            status: [
              { value: "200", count: total - 34 },
              { value: "404", count: 30 },
              { value: "500", count: 4 },
            ],
            method: [
              { value: "GET", count: total - 50 },
              { value: "POST", count: 50 },
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
  if (process.env.TOWBAR_FIXTURE_ANALYTICS_STATE === "empty") {
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
  response.end(JSON.stringify(report));
  return true;
}
