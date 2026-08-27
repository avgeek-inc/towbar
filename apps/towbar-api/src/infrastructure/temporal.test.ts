import assert from "node:assert/strict";
import test from "node:test";

import {
  createPreviewCleanupWorkItem,
  previewLifecycleWorkflowId,
} from "./temporal.js";

void test("uses a stable Source and pull request Preview workflow id", () => {
  const sourceId = "018f47a0-64e7-7b44-8500-2e4cb0c8f9aa";
  assert.equal(
    previewLifecycleWorkflowId(sourceId, 42),
    previewLifecycleWorkflowId(sourceId, 42),
  );
  assert.notEqual(
    previewLifecycleWorkflowId(sourceId, 42),
    previewLifecycleWorkflowId(sourceId, 43),
  );
});

void test("uses a fresh coordinator work id for every Preview cleanup attempt", () => {
  const input = {
    appId: "018f47a0-64e7-7b44-8500-2e4cb0c8f9aa",
    buildConcurrency: 4,
    previewBuildConcurrency: 2,
    previewEnvironmentId: "028f47a0-64e7-7b44-8500-2e4cb0c8f9aa",
  };
  const first = createPreviewCleanupWorkItem(
    input,
    "038f47a0-64e7-7b44-8500-2e4cb0c8f9aa",
  );
  const retry = createPreviewCleanupWorkItem(
    input,
    "048f47a0-64e7-7b44-8500-2e4cb0c8f9aa",
  );

  assert.notEqual(first.id, retry.id);
  assert.equal(first.previewEnvironmentId, retry.previewEnvironmentId);
});
