import assert from "node:assert/strict";
import test from "node:test";

import { pullRequestDeploymentPlanIdentity } from "./identity.js";

void test("uses one identity for repeated evaluation of the same pull request head", () => {
  const input = {
    pullRequestNumber: 42,
    sourceId: "source-1",
    targetCommitSha: "abc123",
  };

  assert.equal(
    pullRequestDeploymentPlanIdentity(input),
    pullRequestDeploymentPlanIdentity({ ...input }),
  );
  assert.notEqual(
    pullRequestDeploymentPlanIdentity(input),
    pullRequestDeploymentPlanIdentity({
      ...input,
      targetCommitSha: "def456",
    }),
  );
});
