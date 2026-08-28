import assert from "node:assert/strict";
import test from "node:test";

import { nextPreviewCleanupAttemptAt } from "./cleanup-retry.js";

const now = new Date("2026-08-28T00:00:00.000Z");

void test("backs cleanup retries off and caps the delay", () => {
  assert.equal(
    nextPreviewCleanupAttemptAt(1, now).toISOString(),
    "2026-08-28T00:05:00.000Z",
  );
  assert.equal(
    nextPreviewCleanupAttemptAt(2, now).toISOString(),
    "2026-08-28T00:15:00.000Z",
  );
  assert.equal(
    nextPreviewCleanupAttemptAt(3, now).toISOString(),
    "2026-08-28T01:00:00.000Z",
  );
  assert.equal(
    nextPreviewCleanupAttemptAt(99, now).toISOString(),
    "2026-08-28T06:00:00.000Z",
  );
});
