import assert from "node:assert/strict";
import { test } from "node:test";
import type { RuntimeState } from "@workspace/towbar-web-client";
import { workloadAttention } from "./overview";

const runtimeState: RuntimeState = {
  checkedAt: null,
  desiredState: "running",
  driftReasons: [],
  driftStatus: "in_sync",
  healthStatus: "healthy",
  observedContainerName: null,
  observedImage: null,
  observedState: "running",
};
void test("only unexpected stopped or missing workloads need attention", () => {
  for (const observedState of ["stopped", "missing"] as const) {
    assert.equal(
      workloadAttention({
        serverReady: true,
        runtimeState: { ...runtimeState, observedState },
      })?.label,
      "Not running",
    );
    assert.equal(
      workloadAttention({
        serverReady: true,
        runtimeState: {
          ...runtimeState,
          observedState,
          desiredState: "stopped",
        },
      }),
      null,
    );
  }
});
void test("unknown health does not invent an outage; unhealthy takes priority over drift", () => {
  assert.equal(
    workloadAttention({
      serverReady: true,
      runtimeState: {
        ...runtimeState,
        observedState: "unknown",
        healthStatus: "unknown",
        driftStatus: "unknown",
      },
    }),
    null,
  );
  assert.equal(
    workloadAttention({
      serverReady: true,
      runtimeState: {
        ...runtimeState,
        healthStatus: "unhealthy",
        driftStatus: "drifted",
      },
    })?.label,
    "Unhealthy",
  );
  assert.equal(
    workloadAttention({
      serverReady: true,
      runtimeState: { ...runtimeState, driftStatus: "drifted" },
    })?.label,
    "Configuration drift",
  );
  assert.equal(
    workloadAttention({ serverReady: false, runtimeState })?.label,
    "Server not ready",
  );
});
