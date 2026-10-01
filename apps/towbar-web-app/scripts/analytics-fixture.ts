import { fixtureJson } from "./fixture-localization.ts";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  analyticsFilterOptionsQuerySchema,
  analyticsQuerySchema,
  analyticsResponseTimeRanges,
  analyticsHttpFilterFields,
  analyticsWebFilterFields,
} from "@workspace/towbar-core";
import type { AnalyticsReport } from "@workspace/towbar-web-client";

export function analyticsFixture(
  _request: IncomingMessage,
  response: ServerResponse,
  url: URL,
) {
  if (
    /^\/v1\/core\/apps\/[^/]+\/analytics\/filter-options$/u.test(url.pathname)
  ) {
    const query = analyticsFilterOptionsQuerySchema.safeParse(
      Object.fromEntries(url.searchParams),
    );
    if (!query.success) {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(
        JSON.stringify({ error: { message: "Invalid filter options" } }),
      );
      return true;
    }
    const allowed =
      query.data.kind === "request"
        ? analyticsHttpFilterFields
        : analyticsWebFilterFields;
    if (!allowed.some((field) => field === query.data.field)) {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          error: {
            message:
              "Choose filters available for the selected analytics measure.",
          },
        }),
      );
      return true;
    }
    const choices = {
      referrer: ["google.com", "github.com", "Unknown"],
      status: ["200", "404", "500"],
      method: ["GET", "POST"],
      responseTime: [...analyticsResponseTimeRanges],
      country: ["IN", "US", "Unknown"],
      city: [
        "Chennai, Tamil Nadu, IN",
        "San Francisco, California, US",
        "Unknown",
        ...Array.from({ length: 25 }, (_, i) => `City ${i + 1}, Region, IN`),
      ],
      browser: ["Chrome", "Safari", "Unknown"],
      device: ["Desktop", "Mobile", "Unknown"],
      destination: ["github.com", "wikipedia.org"],
    }[query.data.field];
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      fixtureJson(response, {
        options: choices.filter((choice) =>
          choice.toLowerCase().includes(query.data.search.toLowerCase()),
        ),
      }),
    );
    return true;
  }
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
  const allowed =
    kind === "request" ? analyticsHttpFilterFields : analyticsWebFilterFields;
  if (
    filters.some((filter) => !allowed.some((field) => field === filter.field))
  ) {
    response.writeHead(400, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        error: {
          message:
            "Choose filters available for the selected analytics measure.",
        },
      }),
    );
    return true;
  }
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
    {
      value: "/",
      share: 0.34,
      referrer: "google.com",
      country: "IN",
      city: "Chennai, Tamil Nadu, IN",
      browser: "Chrome",
    },
    {
      value: "/docs/getting-started",
      share: 0.24,
      referrer: "github.com",
      country: "US",
      city: "San Francisco, California, US",
      browser: "Safari",
    },
    {
      value: "/pricing",
      share: 0.12,
      referrer: "Unknown",
      country: "IN",
      city: "Chennai, Tamil Nadu, IN",
      browser: "Chrome",
    },
    {
      value:
        "/blog/a-long-article-path-that-must-truncate-without-breaking-the-table",
      share: 0.05,
      referrer: "github.com",
      country: "US",
      city: "San Francisco, California, US",
      browser: "Safari",
    },
    {
      value: "/docs/api",
      share: 0.09,
      referrer: "google.com",
      country: "IN",
      city: "Chennai, Tamil Nadu, IN",
      browser: "Chrome",
    },
    {
      value: "/contact",
      share: 0.05,
      referrer: "Unknown",
      country: "Unknown",
      city: "Unknown",
      browser: "Unknown",
    },
    ...Array.from({ length: 25 }, (_, i) => ({
      value: `/cities/${i + 1}`,
      share: 0.11 / 25,
      referrer: "google.com",
      country: "IN",
      city: `City ${i + 1}, Region, IN`,
      browser: "Chrome",
    })),
  ].map((path, index) => ({
    ...path,
    device:
      path.browser === "Chrome"
        ? "Mobile"
        : path.browser === "Safari"
          ? "Desktop"
          : "Unknown",
    method: index === 2 ? "POST" : "GET",
    status: index === 2 ? "404" : index === 5 ? "500" : "200",
    responseTime: analyticsResponseTimeRanges[index % 8]!,
    destination: index % 2 === 0 ? "github.com" : "wikipedia.org",
  }));
  const matchingPaths = paths.filter((path) =>
    filters.every((filter) => {
      if (filter.field === "path")
        return (
          typeof filter.value === "string" &&
          (filter.operator === "equals"
            ? path.value === filter.value
            : path.value.startsWith(filter.value))
        );
      return (
        Array.isArray(filter.value) && filter.value.includes(path[filter.field])
      );
    }),
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
  const previousBuckets = allCounts.map((count, i) =>
    allocate(Math.floor(count * (0.65 + (i % 3) * 0.15))),
  );
  const previousCounts = previousBuckets.map((rows) =>
    rows.reduce((sum, row) => sum + row.count, 0),
  );
  const total = counts.reduce((a, b) => a + b, 0);
  const histogram = analyticsResponseTimeRanges.map((range) =>
    currentBuckets.reduce(
      (sum, rows) =>
        sum +
        rows.reduce(
          (sum, row) =>
            sum +
            (paths.find((path) => path.value === row.value)!.responseTime ===
            range
              ? row.count
              : 0),
          0,
        ),
      0,
    ),
  );
  const dimensionCounts = (
    field:
      | "referrer"
      | "country"
      | "city"
      | "browser"
      | "device"
      | "status"
      | "method"
      | "destination",
  ) => {
    const counts = new Map<string, number>();
    for (const rows of currentBuckets)
      for (const row of rows) {
        const value = paths.find((path) => path.value === row.value)![field];
        counts.set(value, (counts.get(value) ?? 0) + row.count);
      }
    return [...counts].map(([value, count]) => ({ value, count }));
  };
  const errorsIn = (rows: { value: string; count: number }[]) =>
    kind === "pageview"
      ? 0
      : rows.reduce(
          (sum, row) =>
            sum +
            (Number(paths.find((path) => path.value === row.value)!.status) >=
            400
              ? row.count
              : 0),
          0,
        );
  const errorCount = currentBuckets.reduce(
    (sum, rows) => sum + errorsIn(rows),
    0,
  );
  const outboundLinks =
    kind === "pageview" && total
      ? dimensionCounts("destination").map((row) => ({
          ...row,
          count: Math.floor(row.count * 0.1),
        }))
      : [];
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
    errors: errorCount,
    meanMs: total ? 48.2 : null,
    p50Ms: total ? 50 : null,
    p95Ms: total ? 200 : null,
    visitors: kind === "pageview" ? Math.floor(702 * fraction) : null,
    sessions: kind === "pageview" ? Math.floor(841 * fraction) : null,
    bounceRate: kind === "pageview" && total ? 36.4 : null,
    averageTimeMs: kind === "pageview" && total ? 83400 : null,
    exits: kind === "pageview" ? Math.floor(700 * fraction) : 0,
    outboundClicks: outboundLinks.reduce((sum, row) => sum + row.count, 0),
    exitPages:
      kind === "pageview" && total
        ? matchingPaths.map((p) => ({
            value: p.value,
            count: Math.floor(700 * p.share),
          }))
        : [],
    outboundLinks,
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
      errors: errorsIn(currentBuckets[i]!),
      visitors: kind === "pageview" ? Math.floor(count * 0.66) : null,
      sessions: kind === "pageview" ? Math.floor(count * 0.79) : null,
    })),
    comparison:
      days * 2 > 90 || !fraction
        ? null
        : {
            start: new Date(end - 2 * days * 86400000).toISOString(),
            end: new Date(end - days * 86400000).toISOString(),
            total: previousCounts.reduce((sum, count) => sum + count, 0),
            errors: previousBuckets.reduce(
              (sum, rows) => sum + errorsIn(rows),
              0,
            ),
            meanMs: 56.8,
            bounceRate: kind === "pageview" ? 41.2 : null,
            averageTimeMs: kind === "pageview" ? 72100 : null,
            visitors: kind === "pageview" ? Math.floor(640 * fraction) : null,
            sessions: kind === "pageview" ? Math.floor(910 * fraction) : null,
            trend: counts.map((_count, i) => ({
              at: new Date(
                end -
                  days * 86400000 -
                  (counts.length - i) * (days === 1 ? 3600000 : 86400000),
              ).toISOString(),
              count: previousCounts[i]!,
              errors: errorsIn(previousBuckets[i]!),
              visitors:
                kind === "pageview"
                  ? Math.floor(previousCounts[i]! * 0.61)
                  : null,
              sessions:
                kind === "pageview"
                  ? Math.floor(previousCounts[i]! * 0.87)
                  : null,
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
      referrer: dimensionCounts("referrer"),
      ...(kind === "request"
        ? {
            status: dimensionCounts("status"),
            method: dimensionCounts("method"),
          }
        : {
            country: dimensionCounts("country"),
            city: dimensionCounts("city")
              .sort(
                (a, b) => b.count - a.count || a.value.localeCompare(b.value),
              )
              .slice(0, 25),
            browser: dimensionCounts("browser"),
            device: dimensionCounts("device"),
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
