import assert from "node:assert/strict";
import test from "node:test";
import {
  upgradeCanReview,
  upgradeIsActive,
  upgradeNeedsRecovery,
} from "./host-upgrade-state";

void test("restarts and rollback attempts remain pending; failures require host recovery", () => {
  for (const state of [
    "checking",
    "downloading",
    "applying",
    "verifying",
    "restoring",
  ])
    assert(upgradeIsActive(state));
  for (const state of ["failed", "interrupted"]) {
    assert(!upgradeIsActive(state));
    assert(upgradeNeedsRecovery(state));
  }
  for (const state of ["blocked", "succeeded", "recovered", undefined]) {
    assert(!upgradeIsActive(state));
    assert(!upgradeNeedsRecovery(state));
  }
});

void test("a completed upgrade allows review of a newer release", () => {
  const job = { state: "succeeded", targetVersion: "v2.0.17" } as const;
  assert(upgradeCanReview("2.0.18", job));
  assert(upgradeCanReview("v2.1.0", job));
  for (const version of [
    undefined,
    null,
    "2.0.17",
    "v2.0.17",
    "2.0.16",
    "2.0.18-rc.1",
  ])
    assert(!upgradeCanReview(version, job));
  assert(upgradeCanReview("2.0.10", { ...job, targetVersion: "v2.0.9" }));
  assert(!upgradeCanReview("2.0.9", { ...job, targetVersion: "v2.0.10" }));
});

void test("active and recovery jobs remain view-only even when a newer release appears", () => {
  for (const state of [
    "checking",
    "downloading",
    "applying",
    "verifying",
    "restoring",
    "failed",
    "interrupted",
  ] as const)
    assert(!upgradeCanReview("2.0.18", { state, targetVersion: "v2.0.17" }));
  for (const state of ["blocked", "recovered"] as const)
    assert(upgradeCanReview("2.0.17", { state, targetVersion: "v2.0.17" }));
  assert(upgradeCanReview("2.0.17"));
  assert(!upgradeCanReview(null));
});
