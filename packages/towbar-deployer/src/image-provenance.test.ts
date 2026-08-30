import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseImageProvenance } from "./image-provenance.js";

void describe("image provenance", () => {
  void it("parses Docker's content digest and platform", () => {
    const digest = `sha256:${"a".repeat(64)}`;
    assert.deepEqual(parseImageProvenance(`${digest} linux/arm64\n`), {
      imageDigest: digest,
      imagePlatform: "linux/arm64",
    });
  });

  void it("rejects incomplete or malformed output", () => {
    assert.throws(
      () => parseImageProvenance("sha256:not-a-digest linux/amd64"),
      /invalid image provenance/u,
    );
    assert.throws(
      () => parseImageProvenance(`sha256:${"b".repeat(64)}`),
      /invalid image provenance/u,
    );
  });
});
