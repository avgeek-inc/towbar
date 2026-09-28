import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import type { AnalyticsCell, AnalyticsFilter } from "@workspace/towbar-core";
import { analyticsSamples } from "@workspace/towbar-database/schema";
import type { AuthDatabase } from "../../infrastructure/database.js";
import { getAnalyticsFilterOptions, getAnalyticsReport } from "./service.js";

export async function verifyAnalyticsCities({
  db,
  serverId,
  appId,
  workspaceId,
  page,
}: {
  db: AuthDatabase;
  serverId: string;
  appId: string;
  workspaceId: string;
  page: AnalyticsCell;
}) {
  const cells = [
    { city: "Springfield", region: "Illinois", country: "US", count: 3 },
    { city: "Springfield", region: "Massachusetts", country: "US", count: 2 },
    { city: "Springfield", region: "Queensland", country: "AU", count: 1 },
    { city: "São Paulo", region: "São Paulo", country: "BR", count: 1 },
    { country: "IN", count: 4 },
  ].map((location) => ({ ...page, path: "/cities", ...location }));
  for (const hours of [1, 36])
    await db.insert(analyticsSamples).values({
      serverId,
      appId,
      sampleId: randomBytes(16).toString("hex"),
      collectedAt: new Date(Date.now() - hours * 3600000),
      cells,
    });
  const input = { appId, workspaceId, days: 1, kind: "pageview" as const };
  const pathFilter: AnalyticsFilter = {
    field: "path",
    operator: "equals",
    value: "/cities",
  };
  const all = await getAnalyticsReport({ ...input, filters: [pathFilter] });
  assert.deepEqual(all.dimensions.city, [
    { value: "Unknown", count: 4 },
    { value: "Springfield, Illinois, US", count: 3 },
    { value: "Springfield, Massachusetts, US", count: 2 },
    { value: "Springfield, Queensland, AU", count: 1 },
    { value: "São Paulo, São Paulo, BR", count: 1 },
  ]);
  assert.deepEqual(
    await getAnalyticsFilterOptions({
      ...input,
      field: "city",
      search: "SPRINGFIELD",
    }),
    [
      "Springfield, Illinois, US",
      "Springfield, Massachusetts, US",
      "Springfield, Queensland, AU",
    ],
  );
  assert.deepEqual(
    await getAnalyticsFilterOptions({ ...input, field: "city", search: "são" }),
    ["São Paulo, São Paulo, BR"],
  );
  const selected = await getAnalyticsReport({
    ...input,
    filters: [
      pathFilter,
      { field: "city", operator: "in", value: ["Springfield, Illinois, US"] },
    ],
  });
  assert.equal(selected.total, 3);
  assert.equal(selected.comparison?.total, 3);
  assert.equal(
    selected.trend.reduce((sum, point) => sum + point.count, 0),
    3,
  );
  assert.deepEqual(selected.dimensions.city, [
    { value: "Springfield, Illinois, US", count: 3 },
  ]);
  const unknown = await getAnalyticsReport({
    ...input,
    filters: [
      pathFilter,
      { field: "city", operator: "in", value: ["Unknown"] },
    ],
  });
  assert.equal(unknown.total, 4);
  await assert.rejects(
    getAnalyticsFilterOptions({
      ...input,
      workspaceId: randomUUID(),
      field: "city",
      search: "",
    }),
  );
  await assert.rejects(
    getAnalyticsFilterOptions({
      ...input,
      kind: "request",
      field: "city",
      search: "",
    }),
  );
  await assert.rejects(
    getAnalyticsReport({
      ...input,
      kind: "request",
      filters: [{ field: "city", operator: "in", value: ["Unknown"] }],
    }),
  );
  const requests = await getAnalyticsReport({ ...input, kind: "request" });
  assert.equal(requests.dimensions.city, undefined);
}
