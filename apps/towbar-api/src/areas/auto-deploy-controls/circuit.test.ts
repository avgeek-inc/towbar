import assert from "node:assert/strict";
import test from "node:test";

import { defaultAutoDeployCircuit } from "@workspace/towbar-core";

import { nextCircuitAfterFailure, nextCircuitAfterSuccess } from "./circuit.js";

void test("opens only after the configured number of comparable failures", () => {
  const first = nextCircuitAfterFailure({
    circuit: defaultAutoDeployCircuit,
    failureFingerprint: "BUILD_FAILED",
    failureThreshold: 2,
    now: new Date("2026-08-30T00:00:00Z"),
  });
  assert.equal(first.opened, false);
  assert.equal(first.circuit.consecutiveFailures, 1);

  const second = nextCircuitAfterFailure({
    circuit: first.circuit,
    failureFingerprint: "BUILD_FAILED",
    failureThreshold: 2,
    now: new Date("2026-08-30T00:01:00Z"),
  });
  assert.equal(second.opened, true);
  assert.equal(second.circuit.openedAt, "2026-08-30T00:01:00.000Z");
  assert.equal(
    second.circuit.openedReason,
    "2 comparable failures: BUILD_FAILED",
  );
});

void test("a different failure fingerprint starts a new sequence", () => {
  const result = nextCircuitAfterFailure({
    circuit: {
      ...defaultAutoDeployCircuit,
      consecutiveFailures: 2,
      failureFingerprint: "BUILD_FAILED",
    },
    failureFingerprint: "HEALTH_CHECK_FAILED",
    failureThreshold: 3,
  });
  assert.equal(result.opened, false);
  assert.equal(result.circuit.consecutiveFailures, 1);
  assert.equal(result.circuit.failureFingerprint, "HEALTH_CHECK_FAILED");
});

void test("a successful manual deployment can recover an open circuit", () => {
  const openCircuit = {
    consecutiveFailures: 3,
    failureFingerprint: "BUILD_FAILED",
    openedAt: "2026-08-30T00:00:00Z",
    openedReason: "3 comparable failures: BUILD_FAILED",
  };
  assert.deepEqual(
    nextCircuitAfterSuccess({
      circuit: openCircuit,
      manualDeployment: true,
      recoveryPolicy: "on_manual_success",
    }),
    { circuit: defaultAutoDeployCircuit, recovered: true },
  );
  assert.deepEqual(
    nextCircuitAfterSuccess({
      circuit: openCircuit,
      manualDeployment: false,
      recoveryPolicy: "on_manual_success",
    }),
    { circuit: openCircuit, recovered: false },
  );
});
