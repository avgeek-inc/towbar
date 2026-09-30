import assert from "node:assert/strict";
import test from "node:test";

import { composeCommitNeedsReconciliation } from "./deployment-recovery.js";

void test("an uncommitted Compose promotion preserves its candidate", () => {
  assert.equal(
    composeCommitNeedsReconciliation({
      committed: false,
      compose: true,
      state: "switching_traffic",
    }),
    true,
  );
  assert.equal(
    composeCommitNeedsReconciliation({
      committed: false,
      compose: true,
      state: "building",
    }),
    false,
  );
  assert.equal(
    composeCommitNeedsReconciliation({
      committed: false,
      compose: false,
      state: "switching_traffic",
    }),
    false,
  );
});
