import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { releaseCommitPayload } from "./release-commit.js";

void describe("release commit payload", () => {
  void it("keeps provenance and excludes executor-only candidate metadata", () => {
    assert.deepEqual(
      releaseCommitPayload({
        candidatePort: 32_768,
        candidatePorts: [32_768],
        containerName: "towbar-internal-ds-1234",
        containerNames: ["towbar-internal-ds-1234"],
        imageDigest: `sha256:${"a".repeat(64)}`,
        imagePlatform: "linux/arm64",
        imageTag: "towbar/internal-ds:commit-deployment",
        warnings: ["not persisted in release metadata"],
      }),
      {
        containerName: "towbar-internal-ds-1234",
        containerNames: ["towbar-internal-ds-1234"],
        imageDigest: `sha256:${"a".repeat(64)}`,
        imagePlatform: "linux/arm64",
        imageTag: "towbar/internal-ds:commit-deployment",
      },
    );
  });

  void it("accepts the Compose executor's release metadata", () => {
    assert.deepEqual(
      releaseCommitPayload({
        candidatePort: 0,
        candidatePorts: [],
        composeServices: ["web", "worker"],
        containerName: "towbar-stack",
        containerNames: ["towbar-stack"],
        imageDigest: `sha256:${"b".repeat(64)}`,
        imagePlatform: "compose",
        imageTag: "compose:towbar-stack",
        warnings: [],
      }),
      {
        composeServices: ["web", "worker"],
        containerName: "towbar-stack",
        containerNames: ["towbar-stack"],
        imageDigest: `sha256:${"b".repeat(64)}`,
        imagePlatform: "compose",
        imageTag: "compose:towbar-stack",
      },
    );
  });
});
