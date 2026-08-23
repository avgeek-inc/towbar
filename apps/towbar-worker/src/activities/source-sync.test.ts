import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { executeSourceSyncActivity } from "./source-sync.js";

void describe("source sync activity", () => {
  void it("allows repository materialization and admission to exceed the default request timeout", async () => {
    const calls: unknown[][] = [];

    await executeSourceSyncActivity("sync-123", (...args) => {
      calls.push(args);
      return Promise.resolve(undefined);
    });

    assert.deepEqual(calls, [
      [
        "POST",
        "/v1/internal/source-syncs/sync-123/execute",
        undefined,
        { timeoutMs: 120_000 },
      ],
      [
        "POST",
        "/v1/internal/source-syncs/sync-123/auto-deploy",
        undefined,
        { timeoutMs: 120_000 },
      ],
    ]);
  });
});
