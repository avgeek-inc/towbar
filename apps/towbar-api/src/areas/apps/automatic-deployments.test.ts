import assert from "node:assert/strict";
import test from "node:test";

import {
  isSourceSyncEligibleForAutomaticDeployments,
  sourceSyncDeploymentIdempotencyKey,
} from "./automatic-deployments.js";

void test("admits automatic deployments after webhook and operator syncs", () => {
  assert.equal(
    isSourceSyncEligibleForAutomaticDeployments({
      commitSha: "current",
      requestedBy: null,
      status: "succeeded",
    }),
    true,
  );
  assert.equal(
    isSourceSyncEligibleForAutomaticDeployments({
      commitSha: "current",
      requestedBy: "owner",
      status: "succeeded",
    }),
    true,
  );
});

void test("rejects incomplete and unsuccessful syncs", () => {
  assert.equal(
    isSourceSyncEligibleForAutomaticDeployments({
      commitSha: null,
      requestedBy: "owner",
      status: "succeeded",
    }),
    false,
  );
  assert.equal(
    isSourceSyncEligibleForAutomaticDeployments({
      commitSha: "current",
      requestedBy: "owner",
      status: "failed",
    }),
    false,
  );
});

void test("gives each Source sync a retry-safe idempotency scope", () => {
  const input = {
    commitSha: "current",
    deploymentDigest: "desired",
    manifestId: "api",
    sourceId: "source",
  };
  assert.equal(
    sourceSyncDeploymentIdempotencyKey({ ...input, syncId: "sync-1" }),
    "sync:sync-1:source:current:desired:api",
  );
  assert.notEqual(
    sourceSyncDeploymentIdempotencyKey({ ...input, syncId: "sync-1" }),
    sourceSyncDeploymentIdempotencyKey({ ...input, syncId: "sync-2" }),
  );
  assert.equal(
    sourceSyncDeploymentIdempotencyKey(input),
    "push:source:current:desired:api",
  );
});
