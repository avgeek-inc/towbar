import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { analyticsCellSchema } from "@workspace/towbar-core";
import { analyticsSamples } from "@workspace/towbar-database/schema";
import type { AuthDatabase } from "../../infrastructure/database.js";
import { getAnalyticsReport } from "./service.js";

export async function verifyBreakdownLimits(input: {
  db: AuthDatabase;
  appId: string;
  workspaceId: string;
  serverId: string;
}) {
  const at = new Date(Date.now() - 7200000);
  const pages = Array.from({ length: 30 }, (_, index) =>
    analyticsCellSchema.parse({
      appId: input.appId,
      kind: "pageview",
      path: `/breakdown-limit/${String(index).padStart(2, "0")}`,
      referrer: `site-${index}.example.com`,
      method: "GET",
      status: 0,
      country: "IN",
      city: `City ${index}`,
      browser: "Safari",
      device: "Desktop",
      visitor: randomBytes(32).toString("hex"),
      session: randomBytes(32).toString("hex"),
      pageId: randomBytes(32).toString("hex"),
      pageStartedAt: at.toISOString(),
      count: 1,
      bytes: 0,
      durationMs: 0,
      histogram: Array(8).fill(0),
    }),
  );
  await input.db.insert(analyticsSamples).values({
    appId: input.appId,
    serverId: input.serverId,
    sampleId: randomBytes(16).toString("hex"),
    collectedAt: at,
    cells: pages.flatMap((page, index) => [
      page,
      analyticsCellSchema.parse({
        ...page,
        kind: "outbound",
        destination: `outbound-${index}.example.com`,
      }),
    ]),
  });
  const report = await getAnalyticsReport({
    appId: input.appId,
    workspaceId: input.workspaceId,
    days: 1,
    kind: "pageview",
    filters: [
      { field: "path", operator: "startsWith", value: "/breakdown-limit/" },
    ],
  });
  assert.equal(report.total, 30);
  assert.equal(report.dimensions.path?.length, 25);
  assert.equal(report.dimensions.referrer?.length, 25);
  assert.equal(report.dimensions.city?.length, 25);
  assert.equal(report.exitPages.length, 25);
  assert.equal(report.outboundLinks.length, 25);
  assert.equal(report.exits, 30, "totals still include undisplayed entries");
  assert.equal(report.outboundClicks, 30);
}
