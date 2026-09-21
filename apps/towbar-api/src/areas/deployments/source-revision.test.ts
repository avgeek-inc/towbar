import assert from "node:assert/strict";
import test from "node:test";

import { pullRequestNumberFromRevision } from "./source-revision.js";

void test("finds pull requests in GitHub merge and squash revisions", () => {
  assert.equal(
    pullRequestNumberFromRevision({
      commitMessage: "Merge pull request #142 from example/feature\n\nShip it",
    }),
    142,
  );
  assert.equal(
    pullRequestNumberFromRevision({
      commitMessage: "Improve deployment details (#143)\n\nMore context",
    }),
    143,
  );
  assert.equal(
    pullRequestNumberFromRevision({ gitRef: "refs/pull/144/head" }),
    144,
  );
});

void test("does not infer pull requests from unrelated commit text", () => {
  assert.equal(
    pullRequestNumberFromRevision({
      commitMessage: "Document issue #142 without merging it",
    }),
    null,
  );
  assert.equal(
    pullRequestNumberFromRevision({ gitRef: "refs/heads/main" }),
    null,
  );
});
