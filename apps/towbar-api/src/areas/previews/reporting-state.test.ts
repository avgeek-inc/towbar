import assert from "node:assert/strict";
import test from "node:test";

import { previewReportingErrorMessage } from "./reporting-state.js";

void test("bounds and redacts Preview reporting errors", () => {
  const message = previewReportingErrorMessage(
    new Error(`Bearer secret-token token=top-secret ${"x".repeat(1_100)}`),
  );
  assert.doesNotMatch(message, /secret-token|top-secret/u);
  assert.match(message, /Bearer \[redacted\] token=\[redacted\]/u);
  assert.equal(message.length, 1_000);
});
