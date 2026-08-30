import assert from "node:assert/strict";
import test from "node:test";

import { evaluateAutoDeployPause } from "@workspace/towbar-core";

import { createDeferredAutomaticDeployment } from "./service.js";

void test("a Source pause retains only the latest deferred revision", () => {
  const gate = evaluateAutoDeployPause({ sourcePaused: true });
  assert.equal(gate.paused, true);
  if (!gate.paused) return;
  assert.deepEqual(
    createDeferredAutomaticDeployment({
      commitSha: "newest",
      deploymentDigest: "digest",
      gate,
      manifestId: "api",
      now: new Date("2026-08-30T00:00:00Z"),
    }),
    {
      commitSha: "newest",
      deferredAt: "2026-08-30T00:00:00.000Z",
      deploymentDigest: "digest",
      manifestId: "api",
      reason: "paused",
      scope: "source",
    },
  );
});
