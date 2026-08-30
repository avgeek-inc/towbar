import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { releaseCommitPayload } from "./release-commit.js";

void describe("release commit payload", () => {
  void it("keeps provenance and excludes executor-only candidate metadata", () => {
    assert.deepEqual(
      releaseCommitPayload({
        candidatePort: 32_768,
        containerName: "towbar-internal-ds-1234",
        imageDigest: `sha256:${"a".repeat(64)}`,
        imagePlatform: "linux/arm64",
        imageTag: "towbar/internal-ds:commit-deployment",
        warnings: ["not persisted in release metadata"],
      }),
      {
        containerName: "towbar-internal-ds-1234",
        imageDigest: `sha256:${"a".repeat(64)}`,
        imagePlatform: "linux/arm64",
        imageTag: "towbar/internal-ds:commit-deployment",
      },
    );
  });
});
