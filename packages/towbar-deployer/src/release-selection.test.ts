import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { selectDeploymentImage } from "./release-selection.js";

const retainedRelease = {
  commitSha: "a".repeat(40),
  containerName: "towbar-example-old",
  imageTag: "towbar/example:retained",
  releaseId: "00000000-0000-4000-8000-000000000001",
  sourceDeploymentId: "00000000-0000-4000-8000-000000000002",
};

void describe("deployment image selection", () => {
  void it("owns a newly built deploy image", () => {
    assert.deepEqual(
      selectDeploymentImage(
        { kind: "deploy", rollbackRelease: null },
        "towbar/example:new",
      ),
      { imageTag: "towbar/example:new", removeOnFailure: true },
    );
  });

  void it("reuses and preserves the retained rollback image", () => {
    assert.deepEqual(
      selectDeploymentImage(
        { kind: "rollback", rollbackRelease: retainedRelease },
        "towbar/example:unused",
      ),
      { imageTag: retainedRelease.imageTag, removeOnFailure: false },
    );
  });

  void it("fails closed when operation metadata is inconsistent", () => {
    assert.throws(() =>
      selectDeploymentImage(
        { kind: "rollback", rollbackRelease: null },
        "towbar/example:unused",
      ),
    );
    assert.throws(() =>
      selectDeploymentImage(
        { kind: "deploy", rollbackRelease: retainedRelease },
        "towbar/example:new",
      ),
    );
  });
});
