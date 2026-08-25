import assert from "node:assert/strict";
import test from "node:test";

import { getDeploymentDisplayStatus } from "./deployment-status";

void test("explains each queued deployment blocker", () => {
  assert.equal(
    getDeploymentDisplayStatus({
      queueBlocker: "server_check",
      state: "queued",
    }),
    "waiting_for_server_check",
  );
  assert.equal(
    getDeploymentDisplayStatus({
      queueBlocker: "server_preparation",
      state: "queued",
    }),
    "waiting_for_server_preparation",
  );
  assert.equal(
    getDeploymentDisplayStatus({
      queueBlocker: "server_operation",
      state: "queued",
    }),
    "waiting_for_server_operation",
  );
  assert.equal(
    getDeploymentDisplayStatus({
      queueBlocker: "server_capacity",
      state: "queued",
    }),
    "waiting_for_server_capacity",
  );
});

void test("keeps workflow states authoritative after a deployment starts", () => {
  assert.equal(
    getDeploymentDisplayStatus({
      queueBlocker: "server_check",
      state: "waiting_for_server",
    }),
    "waiting_for_server",
  );
});
