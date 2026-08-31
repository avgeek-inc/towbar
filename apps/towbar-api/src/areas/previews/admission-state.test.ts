import assert from "node:assert/strict";
import test from "node:test";

import {
  isPreviewReleaseCurrent,
  previewAdmissionLockKey,
  previewAdmissionReplayAction,
  previewDeploymentIdempotencyKey,
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

void test("replays active Preview work and preserves genuine terminal outcomes", () => {
  assert.equal(
    previewAdmissionReplayAction({
      deploymentErrorCode: null,
      deploymentState: "queued",
      environmentStatus: "building",
    }),
    "enqueue",
  );
  assert.equal(
    previewAdmissionReplayAction({
      deploymentErrorCode: "DEPLOYMENT_FAILED",
      deploymentState: "failed",
      environmentStatus: "failed",
    }),
    "reuse",
  );
});

void test("recovers an uncertain enqueue without reusing cleaned Preview work", () => {
  assert.equal(
    previewAdmissionReplayAction({
      deploymentErrorCode: "TEMPORAL_UNAVAILABLE",
      deploymentState: "failed",
      environmentStatus: "failed",
    }),
    "reset_and_enqueue",
  );
  assert.equal(
    previewAdmissionReplayAction({
      deploymentErrorCode: null,
      deploymentState: "succeeded",
      environmentStatus: "deleted",
    }),
    "replace",
  );
});

void test("uses stable identities when a Preview admission activity is retried", () => {
  assert.equal(
    previewAdmissionLockKey({
      appId: "app-1",
      gitRef: "refs/pull/42/head",
      sourceId: "source-1",
    }),
    "preview-admission:source-1:app-1:refs/pull/42/head",
  );
  assert.equal(
    previewDeploymentIdempotencyKey({
      commitSha: "abc123",
      deploymentDigest: "deployment-digest",
      environmentId: "environment-1",
    }),
    "preview:environment-1:abc123:deployment-digest",
  );
});
