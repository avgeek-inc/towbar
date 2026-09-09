import assert from "node:assert/strict";
import test from "node:test";
import {
  filterServers,
  filterSources,
  filterWorkloads,
  serverFilters,
  sourceFilters,
  workloadFilters,
} from "./inventory.js";
const sourceId = "11111111-1111-4111-8111-111111111111";
const healthy = {
  name: "API",
  sourceId,
  serverIp: "192.0.2.10",
  kind: "app",
  serverReady: true,
  runtimeState: {
    desiredState: "running",
    observedState: "running",
    healthStatus: "healthy",
    driftStatus: "in_sync",
  },
};
void test("inventory filters intersect, preserve all/attention counts, and distinguish intentional stops", () => {
  const stopped = {
    ...healthy,
    name: "Stopped",
    runtimeState: {
      ...healthy.runtimeState,
      desiredState: "stopped",
      observedState: "stopped",
    },
  };
  const missing = {
    ...healthy,
    name: "Missing",
    runtimeState: { ...healthy.runtimeState, observedState: "missing" },
  };
  const unhealthy = {
    ...healthy,
    name: "Cache",
    kind: "redis",
    runtimeState: { ...healthy.runtimeState, healthStatus: "unhealthy" },
  };
  const items = [healthy, stopped, missing, unhealthy];
  const result = filterWorkloads(
    items,
    workloadFilters.parse({
      view: "attention",
      resourceType: "redis",
      q: "CACHE",
      sourceId,
      serverIp: "192.0.2.10",
      health: "unhealthy",
      running: "running",
    }),
  );
  assert.deepEqual(result.items, [unhealthy]);
  assert.deepEqual(result.counts, { all: 4, attention: 2 });
  assert.equal(
    filterWorkloads(
      items,
      workloadFilters.parse({ view: "attention", running: "stopped" }),
    ).items.length,
    0,
  );
  assert.equal(
    filterWorkloads(items, workloadFilters.parse({ serverIp: "192.0.2.11" }))
      .items.length,
    0,
  );
});
void test("servers preserve unknown health and treat disabled Scout separately from offline", () => {
  const items = [
    {
      canonicalIp: "192.0.2.10",
      setupStatus: "ready",
      healthStatus: "healthy",
      scout: { enabled: false, status: "offline" },
    },
    {
      canonicalIp: "192.0.2.11",
      setupStatus: "ready",
      scout: { enabled: true, status: "offline" },
    },
    {
      canonicalIp: "192.0.2.12",
      setupStatus: "failed",
      healthStatus: "unhealthy",
    },
  ];
  assert.deepEqual(
    filterServers(
      items,
      serverFilters.parse({ scout: "disabled", health: "healthy" }),
    ).items,
    [items[0]],
  );
  assert.deepEqual(
    filterServers(
      items,
      serverFilters.parse({ view: "attention", health: "unknown" }),
    ).items,
    [items[1]],
  );
  assert.deepEqual(
    filterServers(items, serverFilters.parse({ setup: "failed", q: ".12" }))
      .counts,
    { all: 3, attention: 2 },
  );
});
void test("source filters use latest sync outcomes and deployment pause independently", () => {
  const items = [
    {
      repositoryOwner: "Acme",
      repositoryName: "Web",
      latestSyncStatus: "failed",
      autoDeployPaused: false,
    },
    {
      repositoryOwner: "Acme",
      repositoryName: "API",
      latestSyncStatus: "succeeded",
      autoDeployPaused: true,
    },
  ];
  assert.deepEqual(
    filterSources(
      items,
      sourceFilters.parse({
        view: "attention",
        sync: "failed",
        autoDeploy: "enabled",
        q: "acme/web",
      }),
    ).items,
    [items[0]],
  );
  assert.equal(
    filterSources(
      items,
      sourceFilters.parse({ view: "attention", autoDeploy: "paused" }),
    ).items.length,
    0,
  );
});
void test("inventory filter validation rejects unsupported state, malformed ids and long search", () => {
  assert.equal(workloadFilters.safeParse({ sourceId: "wrong" }).success, false);
  assert.equal(workloadFilters.safeParse({ health: "good" }).success, false);
  assert.equal(serverFilters.safeParse({ scout: "good" }).success, false);
  assert.equal(sourceFilters.safeParse({ autoSync: "true" }).success, false);
  assert.equal(sourceFilters.safeParse({ q: "x".repeat(201) }).success, false);
});
