import assert from "node:assert/strict";
import test from "node:test";

import type { Deployment } from "@workspace/towbar-web-client";

import {
  getActiveDeploymentStates,
  resolveInventoryStatus,
  resolveInventorySyncStatus,
} from "./inventory-status";

const deployment = (input: Partial<Deployment>): Deployment => ({
  appId: "deployable-1",
  commitSha: "abcdef123456",
  createdAt: "2026-08-25T12:00:00.000Z",
  deployableKind: "postgres",
  environment: "production",
  errorCode: null,
  errorMessage: null,
  finishedAt: null,
  id: "deployment-1",
  gitRef: null,
  githubDeploymentId: null,
  hostname: null,
  kind: "deploy",
  manifestDigest: "digest",
  serverId: "server-1",
  sourceId: "source-1",
  startedAt: null,
  state: "queued",
  trigger: "auto_deploy",
  updatedAt: "2026-08-25T12:00:00.000Z",
  ...input,
});

void test("uses the newest active deployment state for each deployable", () => {
  const states = getActiveDeploymentStates([
    deployment({
      createdAt: "2026-08-25T12:02:00.000Z",
      id: "deployment-3",
      state: "building",
    }),
    deployment({
      createdAt: "2026-08-25T12:01:00.000Z",
      id: "deployment-2",
      state: "queued",
    }),
    deployment({
      createdAt: "2026-08-25T12:03:00.000Z",
      finishedAt: "2026-08-25T12:04:00.000Z",
      id: "deployment-4",
      state: "succeeded",
    }),
  ]);

  assert.equal(states.get("deployable-1"), "building");
});

void test("surfaces an active deployment instead of unknown inventory state", () => {
  assert.equal(resolveInventorySyncStatus("unknown", "queued"), "queued");
  assert.equal(
    resolveInventoryStatus({
      activeDeploymentState: "queued",
      archived: false,
      healthStatus: "unknown",
      serverReady: true,
    }),
    "queued",
  );
});

void test("keeps server setup and archive states authoritative", () => {
  assert.equal(
    resolveInventoryStatus({
      activeDeploymentState: "waiting_for_server",
      archived: false,
      healthStatus: "unknown",
      serverReady: false,
    }),
    "server_setup_pending",
  );
  assert.equal(
    resolveInventoryStatus({
      activeDeploymentState: "queued",
      archived: true,
      healthStatus: "unknown",
      serverReady: true,
    }),
    "archived",
  );
});
