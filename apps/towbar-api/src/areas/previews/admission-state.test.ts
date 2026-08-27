import assert from "node:assert/strict";
import test from "node:test";

import { shouldDeferPreviewAdmission } from "./admission-state.js";

void test("defers a pull request update while cleanup owns the Preview environment", () => {
  assert.equal(shouldDeferPreviewAdmission("deleting"), true);
  assert.equal(shouldDeferPreviewAdmission("deleted"), false);
  assert.equal(shouldDeferPreviewAdmission("cleanup_failed"), false);
});
