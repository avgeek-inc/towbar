import assert from "node:assert/strict";
import test from "node:test";
import {
  analyticsResponseTimeRanges,
  type AnalyticsFilter,
} from "@workspace/towbar-web-client";
import { analyticsQuerySchema } from "@workspace/towbar-core";
import {
  analyticsRowFilterMatches,
  toggleAnalyticsRowFilter,
} from "./analytics-row-filter";

test("each supported non-path row adds a canonical dimension filter", () => {
  for (const [field, value] of Object.entries({
    country: "CA",
    city: "Montreal, Quebec, CA",
    referrer: "www.google.com",
    browser: "Chrome",
    device: "Desktop",
    destination: "example.org",
    status: "404",
    method: "GET",
    responseTime: analyticsResponseTimeRanges[0],
  })) {
    const filters = toggleAnalyticsRowFilter(
      [],
      field as AnalyticsFilter["field"],
      value,
    );
    assert.deepEqual(filters, [{ field, operator: "in", value: [value] }]);
    assert.equal(
      analyticsQuerySchema.safeParse({
        kind: ["method", "status", "responseTime"].includes(field)
          ? "request"
          : "pageview",
        filters: JSON.stringify(filters),
      }).success,
      true,
    );
    assert.equal(
      analyticsRowFilterMatches(
        filters[0]!,
        field as AnalyticsFilter["field"],
        value,
      ),
      true,
    );
    assert.deepEqual(
      toggleAnalyticsRowFilter(
        filters,
        field as AnalyticsFilter["field"],
        value,
      ),
      [],
    );
  }
});

test("removing one selected country preserves other countries and AND conditions", () => {
  const path: AnalyticsFilter = {
    field: "path",
    operator: "startsWith",
    value: "/docs",
  };
  const filters: AnalyticsFilter[] = [
    path,
    { field: "country", operator: "in", value: ["CA", "IN"] },
  ];
  assert.deepEqual(toggleAnalyticsRowFilter(filters, "country", "CA"), [
    path,
    { field: "country", operator: "in", value: ["IN"] },
  ]);
  assert.deepEqual(toggleAnalyticsRowFilter(filters, "country", "US"), [
    path,
    { field: "country", operator: "in", value: ["CA", "IN", "US"] },
  ]);
  assert.deepEqual(
    toggleAnalyticsRowFilter(filters, "path", "/docs/getting-started"),
    [filters[1]],
  );
});

test("outbound filters remain separate from referring website filters", () => {
  const referrer: AnalyticsFilter = {
    field: "referrer",
    operator: "in",
    value: ["example.org"],
  };
  assert.equal(
    analyticsRowFilterMatches(referrer, "destination", "example.org"),
    false,
  );
  assert.deepEqual(
    toggleAnalyticsRowFilter([referrer], "destination", "example.org"),
    [
      referrer,
      { field: "destination", operator: "in", value: ["example.org"] },
    ],
  );
});

test("row actions respect condition and value caps", () => {
  const filters: AnalyticsFilter[] = Array.from({ length: 8 }, (_, i) => ({
    field: "path",
    operator: "equals",
    value: `/page/${i}`,
  }));
  assert.equal(toggleAnalyticsRowFilter(filters, "country", "IN"), filters);
  assert.equal(toggleAnalyticsRowFilter(filters, "path", "/page/7").length, 7);
  const methods: AnalyticsFilter[] = [
    {
      field: "method",
      operator: "in",
      value: Array.from({ length: 20 }, (_, i) => `METHOD${i}`),
    },
  ];
  assert.equal(toggleAnalyticsRowFilter(methods, "method", "NEW"), methods);
});
