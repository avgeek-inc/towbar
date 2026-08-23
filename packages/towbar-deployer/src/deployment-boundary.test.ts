import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveDeploymentFailureBoundary } from "./promotion-boundary.js";

void describe("deployment promotion failure boundary", () => {
  void it("rolls back only before a release commit is attempted", () => {
    assert.equal(
      resolveDeploymentFailureBoundary({
        commitAttempted: false,
        commitConfirmed: false,
      }),
      "rollback",
    );
  });

  void it("defers an ambiguous commit outcome to durable recovery", () => {
    assert.equal(
      resolveDeploymentFailureBoundary({
        commitAttempted: true,
        commitConfirmed: false,
      }),
      "commit-uncertain",
    );
  });

  void it("never rolls back after the commit response is confirmed", () => {
    assert.equal(
      resolveDeploymentFailureBoundary({
        commitAttempted: true,
        commitConfirmed: true,
      }),
      "committed",
    );
  });
});
