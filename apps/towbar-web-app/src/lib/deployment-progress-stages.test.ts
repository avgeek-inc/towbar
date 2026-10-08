import assert from "node:assert/strict";
import test from "node:test";
import type { DeploymentStep } from "@workspace/towbar-web-client";

import { deploymentProgressStages } from "./deployment-progress-stages";

const startedAt = "2026-10-08T12:00:00.000Z";
const finishedAt = "2026-10-08T12:01:00.000Z";

function step(
  state: DeploymentStep["state"],
  sequence: number,
  status: DeploymentStep["status"] = "succeeded",
): DeploymentStep {
  return {
    id: `${state}-${sequence}`,
    state,
    sequence,
    status,
    createdAt: startedAt,
    startedAt,
    finishedAt: status === "running" ? null : finishedAt,
    message: null,
  };
}

function itemAt<T>(items: T[], index: number): T {
  const item = items[index];
  assert.ok(item);
  return item;
}

void test("groups every workflow step once and keeps traffic switching in deployment", () => {
  const groups: DeploymentStep["state"][][] = [
    [
      "queued",
      "waiting_for_server",
      "preparing",
      "validating_credentials",
      "checking_server",
    ],
    ["fetching_source", "resolving_secrets", "transferring", "building"],
    [
      "running_pre_deploy",
      "starting_candidate",
      "checking_health",
      "configuring_routing",
      "provisioning_tls",
      "checking_public_endpoint",
      "switching_traffic",
    ],
    ["running_post_deploy", "cleaning_up"],
  ];
  const steps = groups.flat().map((state, index) => step(state, index));
  const stages = deploymentProgressStages(
    { state: "succeeded", finishedAt },
    [...steps].reverse(),
  );
  assert.deepEqual(
    stages.map((stage) => stage.title),
    [
      "Validating setup",
      "Preparing artifacts",
      "Deploying artifacts",
      "Finishing up",
    ],
  );
  assert.deepEqual(
    stages.map((stage) => stage.steps.map((item) => item.state)),
    groups,
  );
  assert.deepEqual(
    stages.map((stage) => stage.status),
    Array(4).fill("succeeded"),
  );
});

void test("waiting for a server does not start the validation stage timer", () => {
  const stages = deploymentProgressStages(
    { state: "waiting_for_server", finishedAt: null },
    [step("queued", 0), step("waiting_for_server", 1, "running")],
  );
  assert.equal(itemAt(stages, 0).steps.length, 2);
  assert.ok(
    stages.every(
      (stage) => stage.status === "waiting" && stage.startedAt === null,
    ),
  );
});

void test("keeps the current stage running between individual steps", () => {
  const stages = deploymentProgressStages(
    { state: "checking_health", finishedAt: null },
    [step("starting_candidate", 0)],
  );
  assert.equal(itemAt(stages, 2).status, "running");
  assert.equal(itemAt(stages, 2).startedAt, startedAt);
  assert.equal(itemAt(stages, 2).finishedAt, null);
  assert.equal(itemAt(stages, 3).status, "waiting");
});

void test("failure and cancellation stop the affected stage timer", () => {
  for (const state of ["failed", "cancelled"] as const) {
    const stages = deploymentProgressStages({ state, finishedAt }, [
      step("checking_server", 0),
      step("building", 1, "running"),
    ]);
    assert.equal(itemAt(stages, 0).status, "succeeded");
    assert.equal(itemAt(stages, 1).status, state);
    assert.equal(itemAt(stages, 1).finishedAt, finishedAt);
    assert.equal(itemAt(itemAt(stages, 1).steps, 0).status, state);
    assert.equal(itemAt(itemAt(stages, 1).steps, 0).finishedAt, finishedAt);
    assert.equal(itemAt(stages, 2).status, "waiting");
  }
});

void test("optional skipped work does not hide a completed stage or a failure", () => {
  const stages = deploymentProgressStages({ state: "failed", finishedAt }, [
    step("starting_candidate", 0),
    step("provisioning_tls", 1, "skipped"),
    step("checking_public_endpoint", 2, "failed"),
    step("running_post_deploy", 3, "skipped"),
  ]);
  assert.equal(itemAt(stages, 2).status, "failed");
  assert.equal(itemAt(stages, 3).status, "skipped");
  const successful = deploymentProgressStages(
    { state: "succeeded_with_warnings", finishedAt },
    [
      step("running_post_deploy", 0, "skipped"),
      step("cleaning_up", 1, "running"),
    ],
  );
  assert.equal(itemAt(successful, 3).status, "succeeded");
  assert.equal(itemAt(successful, 3).finishedAt, finishedAt);
});
