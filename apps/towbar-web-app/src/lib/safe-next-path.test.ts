import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { safeNextPath } from "./safe-next-path.js";

describe("safeNextPath", () => {
  it("preserves application-local paths, queries, and fragments", () => {
    assert.equal(
      safeNextPath("/sources/123?section=apps#activity"),
      "/sources/123?section=apps#activity",
    );
  });

  it("rejects absolute and network-path redirects", () => {
    for (const candidate of [
      "https://example.com",
      "//example.com",
      "///example.com",
      "/\\example.com",
      "/\\\\example.com",
      "/%2F%2Fexample.com",
      "/%5Cexample.com",
    ]) {
      assert.equal(safeNextPath(candidate), "/", candidate);
    }
  });

  it("keeps authentication transitions from redirecting to themselves", () => {
    assert.equal(safeNextPath("/login"), "/");
    assert.equal(safeNextPath("/login?next=/sources"), "/");
    assert.equal(safeNextPath("/logout"), "/");
    assert.equal(safeNextPath("/logout#complete"), "/");
  });
});
