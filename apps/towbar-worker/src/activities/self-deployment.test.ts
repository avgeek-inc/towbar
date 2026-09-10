import assert from "node:assert/strict";
import test from "node:test";
import type { DeploymentExecutionContext } from "@workspace/towbar-deployer";
import { isWorkerSelfDeployment } from "./self-deployment.js";

void test("worker cleanup is deferred only for its exact persistent or preview runtime", () => {
  const production = {
    app: { id: "towbar-worker" },
    deployableId: "11111111-1111-4111-8111-111111111111",
  } as DeploymentExecutionContext;
  const staging = {
    ...production,
    deployableId: "22222222-2222-4222-8222-222222222222",
  };
  const preview = {
    ...production,
    runtimeId: "33333333-3333-4333-8333-333333333333",
  };
  assert.equal(
    isWorkerSelfDeployment(production.deployableId, production),
    true,
  );
  assert.equal(isWorkerSelfDeployment(production.deployableId, staging), false);
  assert.equal(isWorkerSelfDeployment(production.deployableId, preview), false);
  assert.equal(isWorkerSelfDeployment(preview.runtimeId, preview), true);
  assert.equal(isWorkerSelfDeployment(production.app.id, production), false);
  assert.equal(isWorkerSelfDeployment(undefined, production), false);
});
