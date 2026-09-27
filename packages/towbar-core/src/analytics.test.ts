import assert from "node:assert/strict";
import test from "node:test";
import { analyticsCellSchema, analyticsConfigSchema } from "./analytics.js";

void test("analytics requires explicit opt-in and pageviews for identity", () => {
  assert.equal(
    analyticsConfigSchema.safeParse({ enabled: false }).success,
    false,
  );
  assert.equal(
    analyticsConfigSchema.safeParse({ enabled: true, visitorIdentity: true })
      .success,
    false,
  );
  assert.deepEqual(analyticsConfigSchema.parse({ enabled: true }), {
    enabled: true,
    pageviews: false,
    visitorIdentity: false,
    retentionDays: 30,
    excludePaths: [],
  });
  assert.equal(
    analyticsConfigSchema.safeParse({ enabled: true, retentionDays: 365 })
      .success,
    false,
  );
});
void test("request payloads reject IP addresses, identities, queries, and inconsistent histograms", () => {
  const cell = {
    appId: "11111111-1111-4111-8111-111111111111",
    kind: "request",
    path: "/",
    referrer: "",
    method: "GET",
    status: 200,
    country: "",
    browser: "",
    device: "",
    visitor: "",
    session: "",
    count: 1,
    bytes: 100,
    durationMs: 5,
    histogram: [1, 0, 0, 0, 0, 0, 0, 0],
  };
  assert(analyticsCellSchema.safeParse(cell).success);
  for (const patch of [
    { ip: "1.2.3.4" },
    { path: "/?secret=x" },
    { visitor: "a".repeat(64) },
    { histogram: Array(8).fill(0) },
  ])
    assert(!analyticsCellSchema.safeParse({ ...cell, ...patch }).success);
});
