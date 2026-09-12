import assert from "node:assert/strict";
import test from "node:test";

import {
  deploymentCleanupId,
  deploymentRemoteIdentity,
  deploymentRuntimeId,
} from "./deployment-identity.js";

import type { DeploymentExecutionContext } from "./types.js";

const context = {
  app: { id: "website", kind: "app" },
  commitSha: "a".repeat(40),
  deployableId: "00000000-0000-4000-8000-000000000001",
  deploymentId: "00000000-0000-4000-8000-000000000002",
  runtimeId: "website-preview-123456789abc",
} as DeploymentExecutionContext;

void test("uses a Preview-scoped runtime identity for Preview deployments", () => {
  assert.equal(deploymentRuntimeId(context), context.runtimeId);
  assert.equal(deploymentCleanupId(context), context.runtimeId);
  assert.match(
    deploymentRemoteIdentity(context).containerName,
    /^towbar-website-preview-123456789abc-/u,
  );
});

void test("persistent siblings with the same manifest ID have separate runtime and cleanup identities", () => {
  const production = { ...context, runtimeId: undefined };
  const staging = {
    ...production,
    deployableId: "00000000-0000-4000-8000-000000000003",
  };
  assert.equal(deploymentRuntimeId(production), production.deployableId);
  assert.equal(deploymentCleanupId(staging), staging.deployableId);
  assert.notEqual(
    deploymentRemoteIdentity(production).containerName,
    deploymentRemoteIdentity(staging).containerName,
  );
  assert.notEqual(
    deploymentRemoteIdentity(production).imageTag,
    deploymentRemoteIdentity(staging).imageTag,
  );
});
