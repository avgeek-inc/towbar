import assert from "node:assert/strict";
import test from "node:test";

import { previewLifecycleWorkflowId } from "./temporal.js";

void test("uses a stable Source and ref Preview workflow id", () => {
  const sourceId = "018f47a0-64e7-7b44-8500-2e4cb0c8f9aa";
  assert.equal(
    previewLifecycleWorkflowId(sourceId, "feature/TW-4"),
    previewLifecycleWorkflowId(sourceId, "feature/TW-4"),
  );
  assert.notEqual(
    previewLifecycleWorkflowId(sourceId, "feature/TW-4"),
    previewLifecycleWorkflowId(sourceId, "feature/TW-5"),
  );
});
