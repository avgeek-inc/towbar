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
    { city: "Chennai", country: "IN" },
    { region: "Tamil Nadu", city: "Chennai", country: "IN" },
    { histogram: Array(8).fill(0) },
  ])
    assert(!analyticsCellSchema.safeParse({ ...cell, ...patch }).success);
});

void test("analytics filters validate bounded AND conditions", async () => {
  const { analyticsQuerySchema } = await import("./analytics.js");
  assert.deepEqual(analyticsQuerySchema.parse({}).filters, []);
  const filters = [
    { field: "path", operator: "startsWith", value: "/docs" },
    { field: "path", operator: "equals", value: "/docs/api" },
  ];
  assert.deepEqual(
    analyticsQuerySchema.parse({ filters: JSON.stringify(filters) }).filters,
    filters,
  );
  const selected = [
    { field: "referrer", operator: "in", value: ["example.com", "Unknown"] },
    { field: "country", operator: "in", value: ["IN", "US"] },
    { field: "browser", operator: "in", value: ["Chrome"] },
    {
      field: "city",
      operator: "in",
      value: ["Chennai, Tamil Nadu, IN", "Unknown"],
    },
  ];
  assert.deepEqual(
    analyticsQuerySchema.parse({ filters: JSON.stringify(selected) }).filters,
    selected,
  );
  for (const value of [
    "{",
    "{}",
    "null",
    JSON.stringify(Array(9).fill(filters[0])),
    ...[
      { ...filters[0], field: "country" },
      { ...filters[0], operator: "contains" },
      { ...filters[0], value: "docs" },
      { ...filters[0], value: "/docs?token=secret" },
      { ...filters[0], value: "/docs#section" },
      { ...filters[0], value: "/docs\n" },
      { ...filters[0], value: "/" + "a".repeat(256) },
      { ...filters[0], extra: true },
      { field: "referrer", operator: "in", value: [] },
      { field: "country", operator: "in", value: ["IND"] },
      { field: "browser", operator: "in", value: ["chrome"] },
      { field: "city", operator: "in", value: ["Chennai\n"] },
      { field: "browser", operator: "in", value: ["Safari", "Safari"] },
      {
        field: "referrer",
        operator: "in",
        value: Array(21).fill("example.com"),
      },
    ].map((filter) => JSON.stringify([filter])),
  ])
    assert.equal(
      analyticsQuerySchema.safeParse({ filters: value }).success,
      false,
      value,
    );
});

void test("city data is optional for older agents and bounded for pageviews", () => {
  const page = {
    appId: "11111111-1111-4111-8111-111111111111",
    kind: "pageview",
    path: "/",
    referrer: "",
    method: "GET",
    status: 0,
    country: "IN",
    browser: "Safari",
    device: "Mobile",
    visitor: "",
    session: "",
    count: 1,
    bytes: 0,
    durationMs: 0,
    histogram: Array(8).fill(0),
  };
  assert(analyticsCellSchema.safeParse(page).success);
  assert(
    analyticsCellSchema.safeParse({
      ...page,
      city: "Chennai",
      region: "Tamil Nadu",
    }).success,
  );
  assert(
    analyticsCellSchema.safeParse({ ...page, country: "BR", city: "São Paulo" })
      .success,
  );
  for (const patch of [
    { city: "x".repeat(129) },
    { city: "Chennai\n" },
    { city: "Chennai\u202e" },
    { city: "Chennai", region: "x".repeat(97) },
    { city: "Chennai", country: "" },
    { region: "Tamil Nadu" },
  ])
    assert(!analyticsCellSchema.safeParse({ ...page, ...patch }).success);
});
