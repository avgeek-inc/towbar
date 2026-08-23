import assert from "node:assert/strict";
import test from "node:test";

import { collectRetainedImageTags } from "./image-retention.js";

void test("retains current, previous, and queued rollback images", () => {
  assert.deepEqual(
    collectRetainedImageTags(
      [
        { imageTag: "towbar/example:current" },
        { imageTag: "towbar/example:previous" },
      ],
      [
        {
          rollbackReleaseSnapshot: {
            imageTag: "towbar/example:reserved-rollback",
          },
        },
        { rollbackReleaseSnapshot: null },
      ],
    ),
    [
      "towbar/example:current",
      "towbar/example:previous",
      "towbar/example:reserved-rollback",
    ],
  );
});

void test("deduplicates an image shared by a release and rollback reservation", () => {
  assert.deepEqual(
    collectRetainedImageTags(
      [{ imageTag: "towbar/example:shared" }],
      [
        {
          rollbackReleaseSnapshot: { imageTag: "towbar/example:shared" },
        },
      ],
    ),
    ["towbar/example:shared"],
  );
});
