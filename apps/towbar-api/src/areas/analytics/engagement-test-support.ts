import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { analyticsCellSchema } from "@workspace/towbar-core";
import { analyticsSamples } from "@workspace/towbar-database/schema";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import { getAnalyticsReport } from "./service.js";
import { getPageEngagement } from "./engagement.js";

export async function verifyPageEngagement(input: {
  appId: string;
  workspaceId: string;
  serverId: string;
}) {
  const db = getTowbarDatabase();
  const now = Date.now(),
    closed = new Date(now - 7200000),
    active = new Date(now - 60000);
  const base = analyticsCellSchema.parse({
    appId: input.appId,
    kind: "pageview",
    path: "/docs",
    referrer: "",
    method: "GET",
    status: 0,
    country: "",
    browser: "Chrome",
    device: "Desktop",
    visitor: "a".repeat(64),
    session: "1".repeat(64),
    pageId: "1".repeat(64),
    pageStartedAt: closed.toISOString(),
    count: 1,
    bytes: 0,
    durationMs: 0,
    histogram: Array(8).fill(0),
  });
  const pages = [
    base,
    { ...base, session: "2".repeat(64), pageId: "2".repeat(64) },
    {
      ...base,
      session: "2".repeat(64),
      pageId: "3".repeat(64),
      path: "/pricing",
      pageStartedAt: new Date(closed.getTime() + 1000).toISOString(),
    },
    { ...base, session: "", visitor: "", pageId: "4".repeat(64) },
  ];
  const samples = [];
  try {
    for (const [at, cells] of [
      [
        closed,
        [
          ...pages,
          { ...base, kind: "engagement", visibleMs: 20000 },
          { ...base, kind: "outbound", destination: "github.com", count: 2 },
        ],
      ],
      [
        new Date(closed.getTime() + 30000),
        [
          { ...base, kind: "engagement", visibleMs: 30000 },
          { ...pages[3], kind: "engagement", visibleMs: 10000 },
        ],
      ],
      [
        active,
        [
          {
            ...base,
            session: "5".repeat(64),
            pageId: "5".repeat(64),
            pageStartedAt: active.toISOString(),
          },
        ],
      ],
    ] as const) {
      const sampleId = randomBytes(16).toString("hex");
      samples.push(sampleId);
      await db.insert(analyticsSamples).values({
        serverId: input.serverId,
        appId: input.appId,
        sampleId,
        collectedAt: at,
        cells: cells.map((c) => analyticsCellSchema.parse(c)),
      });
    }
    const report = await getAnalyticsReport({
      ...input,
      days: 1,
      kind: "pageview",
    });
    assert.equal(
      report.averageTimeMs,
      8000,
      "cumulative snapshots use max, hidden time isn't added, old pages are excluded",
    );
    assert.equal(
      report.bounceRate,
      50,
      "ongoing and anonymous visits are excluded",
    );
    assert.equal(report.exits, 2);
    assert.deepEqual(report.exitPages, [
      { value: "/docs", count: 1 },
      { value: "/pricing", count: 1 },
    ]);
    assert.equal(report.outboundClicks, 2);
    assert.deepEqual(report.outboundLinks, [{ value: "github.com", count: 2 }]);
    const filtered = await getAnalyticsReport({
      ...input,
      days: 1,
      kind: "pageview",
      filters: [{ field: "path", operator: "equals", value: "/docs" }],
    });
    assert.equal(
      filtered.bounceRate,
      50,
      "filtering a multi-page visit must not turn it into a bounce",
    );
    assert.equal(filtered.averageTimeMs, 10000);
    assert.deepEqual(filtered.exitPages, [{ value: "/docs", count: 1 }]);
    const anonymous = await getPageEngagement(db, {
      appId: input.appId,
      start: new Date(now - 86400000),
      end: new Date(),
      retentionDays: 7,
      identity: false,
      conditions: sql`true`,
    });
    assert.equal(anonymous.bounceRate, null);
    assert.equal(anonymous.averageTimeMs, 8000);
    assert.deepEqual(anonymous.exitPages, []);
    const legacySample = randomBytes(16).toString("hex");
    samples.push(legacySample);
    await db
      .insert(analyticsSamples)
      .values({
        serverId: input.serverId,
        appId: input.appId,
        sampleId: legacySample,
        collectedAt: closed,
        cells: [
          analyticsCellSchema.parse({
            ...base,
            path: "/legacy",
            session: "6".repeat(64),
            pageId: undefined,
            pageStartedAt: undefined,
            count: 2,
          }),
        ],
      });
    const legacy = await getAnalyticsReport({
      ...input,
      days: 1,
      kind: "pageview",
      filters: [{ field: "path", operator: "equals", value: "/legacy" }],
    });
    assert.equal(legacy.bounceRate, 0);
    assert.equal(legacy.averageTimeMs, null);
    assert.equal(
      legacy.exits,
      0,
      "older batches cannot establish page ordering",
    );
  } finally {
    for (const id of samples)
      await db.execute(
        sql`delete from towbar_analytics_samples where sample_id=${id} and app_id=${input.appId}::uuid`,
      );
  }
}
