import assert from "node:assert/strict";
import test from "node:test";

import {
  isPreviewReleaseCurrent,
  shouldDeferPreviewAdmission,
} from "./admission-state.js";

void test("defers a pull request update while cleanup owns the Preview environment", () => {
  assert.equal(shouldDeferPreviewAdmission("deleting"), true);
  assert.equal(shouldDeferPreviewAdmission("deleted"), false);
  assert.equal(shouldDeferPreviewAdmission("cleanup_failed"), false);
});

void test("keeps an input-equivalent Preview release current", () => {
  assert.equal(isPreviewReleaseCurrent("same-inputs", "same-inputs"), true);
  assert.equal(isPreviewReleaseCurrent("old-inputs", "new-inputs"), false);
  assert.equal(isPreviewReleaseCurrent(undefined, "new-inputs"), false);
});
