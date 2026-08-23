import assert from "node:assert/strict";
import test from "node:test";

import {
  assertDeploymentTransition,
  canTransitionDeployment,
  deploymentWorkflowId,
  serverCoordinatorWorkflowId,
} from "./temporal.js";

void test("accepts only forward or terminal deployment transitions", () => {
  assert.equal(canTransitionDeployment("queued", "waiting_for_server"), true);
  assert.equal(canTransitionDeployment("building", "failed"), true);
  assert.equal(canTransitionDeployment("building", "starting_candidate"), true);
  assert.equal(
    canTransitionDeployment("switching_traffic", "cleaning_up"),
    true,
  );
  assert.equal(
    canTransitionDeployment("cleaning_up", "succeeded_with_warnings"),
    true,
  );
  assert.equal(canTransitionDeployment("queued", "skipped"), true);
  assert.equal(canTransitionDeployment("skipped", "waiting_for_server"), false);
  assert.equal(canTransitionDeployment("succeeded", "building"), false);
  assert.throws(() => assertDeploymentTransition("queued", "building"));
});

void test("uses stable workflow ids", () => {
  assert.equal(
    deploymentWorkflowId("018f47a0-64e7-7b44-8500-2e4cb0c8f9aa"),
    "towbar-deployment/018f47a0-64e7-7b44-8500-2e4cb0c8f9aa",
  );
  assert.equal(
    serverCoordinatorWorkflowId("server-hash"),
    "towbar-server/v2/server-hash",
  );
});
