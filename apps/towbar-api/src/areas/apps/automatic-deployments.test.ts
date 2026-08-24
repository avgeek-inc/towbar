import assert from "node:assert/strict";
import test from "node:test";

import { isSourceSyncEligibleForAutomaticDeployments } from "./automatic-deployments.js";

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
