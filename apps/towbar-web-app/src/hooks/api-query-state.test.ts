import assert from "node:assert/strict";
import test from "node:test";
import { canKeepQueryData } from "./api-query-state";

test("range, filter, and pagination changes retain the current view", () => {
  for (const [previous, next] of [
    [
      "/v1/core/apps/one/analytics?days=7",
      "/v1/core/apps/one/analytics?days=30",
    ],
    [
      "/v1/core/deployments/history?page=1",
      "/v1/core/deployments/history?page=2&state=failed",
    ],
    [
      "/v1/core/servers/one/monitoring?range=15m",
      "/v1/core/servers/one/monitoring?range=24h",
    ],
  ])
    assert.equal(canKeepQueryData(previous!, next!, true), true);
});

test("unrelated entities, disabled queries, and repository choices do not reuse data", () => {
  assert.equal(
    canKeepQueryData(
      "/v1/core/apps/one/analytics?days=7",
      "/v1/core/apps/two/analytics?days=7",
      true,
    ),
    false,
  );
  assert.equal(
    canKeepQueryData("/v1/core/apps/one", "/v1/core/apps/one/secrets", true),
    false,
  );
  assert.equal(canKeepQueryData("/v1/core/apps/one", null, true), false);
  assert.equal(
    canKeepQueryData(
      "/v1/core/github/branches?repository=one",
      "/v1/core/github/branches?repository=two",
      false,
    ),
    false,
  );
});
