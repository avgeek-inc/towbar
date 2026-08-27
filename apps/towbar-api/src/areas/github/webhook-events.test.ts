import assert from "node:assert/strict";
import test from "node:test";

import { shouldReconcilePreviewPullRequest } from "./webhook-events.js";

void test("reconciles pull request lifecycle and code changes", () => {
  for (const action of [
    "closed",
    "edited",
    "opened",
    "reopened",
    "synchronize",
  ]) {
    assert.equal(shouldReconcilePreviewPullRequest(action), true, action);
  }
});

void test("ignores pull request metadata changes that cannot affect a Preview", () => {
  for (const action of [
    "assigned",
    "converted_to_draft",
    "labeled",
    "ready_for_review",
    "review_requested",
  ]) {
    assert.equal(shouldReconcilePreviewPullRequest(action), false, action);
  }
});
