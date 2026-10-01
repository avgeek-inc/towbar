import { verifyBreakdownLimits } from "./breakdown-limit-test-support.js";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import {
  type AnalyticsFilter,
  analyticsCellSchema,
  analyticsResponseTimeRanges,
} from "@workspace/towbar-core";
import { analyticsSamples } from "@workspace/towbar-database/schema";
import type { AuthDatabase } from "../../infrastructure/database.js";
import { getAnalyticsFilterOptions, getAnalyticsReport } from "./service.js";

export async function verifyDimensionFilters(input: {
  db: AuthDatabase;
  appId: string;
  workspaceId: string;
  serverId: string;
}) {
  const { db, appId, workspaceId, serverId } = input;
  const request = analyticsCellSchema.parse({
    appId,
    kind: "request",
    path: "/dimension-filters",
    referrer: "github.com",
    method: "GET",
    status: 200,
    country: "",
    browser: "",
    device: "",
    visitor: "",
    session: "",
    count: 6,
    bytes: 600,
    durationMs: 390,
    histogram: [2, 3, 0, 0, 1, 0, 0, 0],
  });
  const pages = Array.from({ length: 12 }, (_, i) =>
    analyticsCellSchema.parse({
      ...request,
      kind: "pageview",
      status: 0,
      count: 1,
      bytes: 0,
      durationMs: 0,
      histogram: Array(8).fill(0),
      country: "IN",
      city: `City ${String(i).padStart(2, "0")}`,
      region: "Region",
      browser: "Safari",
      device: i < 6 ? "Mobile" : "Desktop",
      visitor: String(Math.floor(i / 2) + 1).padStart(64, "0"),
      session: String(i + 1).padStart(64, "0"),
      pageId: String(i + 1).padStart(64, "0"),
      pageStartedAt: new Date(Date.now() - 7200000).toISOString(),
    }),
  );
  for (const hours of [2, 36])
    await db.insert(analyticsSamples).values({
      appId,
      serverId,
      sampleId: randomBytes(16).toString("hex"),
      collectedAt: new Date(Date.now() - hours * 3600000),
      cells: [
        request,
        {
          ...request,
          method: "POST",
          status: 500,
          count: 2,
          bytes: 200,
          durationMs: 160,
          histogram: [0, 0, 2, 0, 0, 0, 0, 0],
        },
        ...pages,
        {
          ...pages[0],
          kind: "outbound",
          destination: hours === 2 ? "github.com" : "wikipedia.org",
          count: 3,
        },
      ].map((cell) => analyticsCellSchema.parse(cell)),
    });
  const base = { appId, workspaceId, days: 1, kind: "request" as const };
  const path: AnalyticsFilter = {
    field: "path",
    operator: "equals",
    value: request.path,
  };
  const http = await getAnalyticsReport({
    ...base,
    filters: [
      path,
      { field: "status", operator: "in", value: ["500"] },
      { field: "method", operator: "in", value: ["POST"] },
    ],
  });
  assert.equal(http.total, 2);
  assert(
    http.trend.every(
      (point) => point.visitors === null && point.sessions === null,
    ),
  );
  assert.equal(http.errors, 2);
  assert.equal(http.comparison?.total, 2);
  assert.equal(http.meanMs, 80);
  assert.deepEqual(http.dimensions.status, [{ value: "500", count: 2 }]);
  const latency = await getAnalyticsReport({
    ...base,
    filters: [
      path,
      {
        field: "responseTime",
        operator: "in",
        value: ["<10 ms", "200 to 500 ms"],
      },
    ],
  });
  assert.equal(latency.total, 3);
  assert.equal(latency.errors, 0);
  assert.equal(latency.comparison?.total, 3);
  assert.equal(latency.meanMs, null);
  assert.equal(latency.bytes, null);
  assert.deepEqual(latency.histogram, [2, 0, 0, 0, 1, 0, 0, 0]);
  assert.equal(
    latency.trend.reduce((sum, row) => sum + row.count, 0),
    3,
  );
  const whole = await getAnalyticsReport({
    ...base,
    filters: [
      path,
      {
        field: "responseTime",
        operator: "in",
        value: [...analyticsResponseTimeRanges],
      },
    ],
  });
  assert.equal(whole.total, 8);
  assert.equal(whole.bytes, 800);
  assert.equal(whole.meanMs, 550 / 8);
  const disjoint = await getAnalyticsReport({
    ...base,
    filters: [
      path,
      { field: "responseTime", operator: "in", value: ["<10 ms"] },
      { field: "responseTime", operator: "in", value: [">2.5 s"] },
    ],
  });
  assert.equal(disjoint.total, 0);
  assert(disjoint.histogram.every((count) => count === 0));
  assert.deepEqual(
    await getAnalyticsFilterOptions({
      ...base,
      field: "responseTime",
      search: "500",
    }),
    ["200 to 500 ms", "500 ms to 1 s"],
  );
  assert(
    (
      await getAnalyticsFilterOptions({
        ...base,
        field: "status",
        search: "500",
      })
    ).includes("500"),
  );
  assert(
    (
      await getAnalyticsFilterOptions({
        ...base,
        field: "method",
        search: "POST",
      })
    ).includes("POST"),
  );

  const web = { ...base, kind: "pageview" as const };
  const cities = await getAnalyticsReport({ ...web, filters: [path] });
  assert.equal(cities.total, 12);
  assert.deepEqual(
    cities.trend
      .filter((point) => point.count > 0)
      .map(({ count, visitors, sessions }) => ({ count, visitors, sessions })),
    [{ count: 12, visitors: 6, sessions: 12 }],
    "trend counts distinct identities within each bucket",
  );
  assert.deepEqual(
    cities.comparison?.trend
      .filter((point) => point.count > 0)
      .map(({ count, visitors, sessions }) => ({ count, visitors, sessions })),
    [{ count: 12, visitors: 6, sessions: 12 }],
  );
  assert(
    cities.trend
      .filter((point) => !point.count)
      .every((point) => point.visitors === 0 && point.sessions === 0),
  );
  assert.equal(cities.dimensions.city?.length, 12);
  assert.equal(
    (
      await getAnalyticsFilterOptions({
        ...web,
        field: "city",
        search: "City ",
      })
    ).length,
    12,
  );
  const mobile = await getAnalyticsReport({
    ...web,
    filters: [path, { field: "device", operator: "in", value: ["Mobile"] }],
  });
  assert.equal(mobile.total, 6);
  assert.deepEqual(
    mobile.trend
      .filter((point) => point.count > 0)
      .map(({ visitors, sessions }) => ({ visitors, sessions })),
    [{ visitors: 3, sessions: 6 }],
    "filters also scope distinct trend identities",
  );
  assert.equal(mobile.comparison?.total, 6);
  assert.deepEqual(mobile.dimensions.device, [{ value: "Mobile", count: 6 }]);
  const outbound = await getAnalyticsReport({
    ...web,
    filters: [
      path,
      { field: "destination", operator: "in", value: ["github.com"] },
    ],
  });
  assert.equal(outbound.total, 1);
  assert.equal(outbound.outboundClicks, 3);
  assert.deepEqual(outbound.outboundLinks, [{ value: "github.com", count: 3 }]);
  assert.equal(
    outbound.comparison,
    null,
    "previous periods must use their own outbound click window",
  );
  assert(
    (
      await getAnalyticsFilterOptions({
        ...web,
        field: "destination",
        search: "github",
      })
    ).some((destination) => destination === "github.com"),
  );
  assert(
    (
      await getAnalyticsFilterOptions({
        ...web,
        field: "device",
        search: "Mobile",
      })
    ).includes("Mobile"),
  );
  for (const field of ["device", "destination"] as const)
    await assert.rejects(
      getAnalyticsReport({
        ...base,
        filters: [{ field, operator: "in", value: ["Mobile"] }],
      }),
    );
  for (const field of ["status", "method", "responseTime"] as const)
    await assert.rejects(
      getAnalyticsFilterOptions({ ...web, field, search: "" }),
    );
  await assert.rejects(
    getAnalyticsFilterOptions({
      ...web,
      workspaceId: randomUUID(),
      field: "destination",
      search: "",
    }),
  );
  await verifyBreakdownLimits(input);
}

export async function verifyAnonymousTrend(input: {
  appId: string;
  workspaceId: string;
}) {
  const report = await getAnalyticsReport({
    ...input,
    days: 1,
    kind: "pageview",
  });
  assert(
    report.trend.every(
      (point) => point.visitors === null && point.sessions === null,
    ),
  );
  assert(
    report.comparison?.trend.every(
      (point) => point.visitors === null && point.sessions === null,
    ),
  );
}
