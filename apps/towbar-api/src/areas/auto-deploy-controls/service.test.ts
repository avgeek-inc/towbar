import assert from "node:assert/strict";
import test from "node:test";

import {
  defaultAutoDeployCircuit,
  defaultAutoDeployControl,
} from "@workspace/towbar-core";

import {
  createDeferredAutomaticDeployment,
  evaluateAutoDeployGate,
} from "./service.js";

void test("a Source pause takes precedence and retains only the latest deferred revision", () => {
  const gate = evaluateAutoDeployGate({
    circuit: defaultAutoDeployCircuit,
    deployableControl: defaultAutoDeployControl,
    sourceControl: { ...defaultAutoDeployControl, paused: true },
  });
  assert.equal(gate.blocked, true);
  if (!gate.blocked) return;
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
      nextEligibleAt: null,
      reason: "paused",
      scope: "source",
    },
  );
});

void test("a deployable circuit is narrow", () => {
  assert.deepEqual(
    evaluateAutoDeployGate({
      circuit: {
        ...defaultAutoDeployCircuit,
        openedAt: "2026-08-30T00:00:00Z",
      },
      deployableControl: defaultAutoDeployControl,
      sourceControl: defaultAutoDeployControl,
    }),
    {
      blocked: true,
      nextOpenAt: null,
      reason: "circuit_open",
      scope: "deployable",
    },
  );
  assert.equal(
    evaluateAutoDeployGate({
      circuit: defaultAutoDeployCircuit,
      deployableControl: defaultAutoDeployControl,
      sourceControl: defaultAutoDeployControl,
    }).blocked,
    false,
  );
});
