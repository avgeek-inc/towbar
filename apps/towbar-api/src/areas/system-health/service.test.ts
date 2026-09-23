import assert from "node:assert/strict";
import test from "node:test";

import { highestStatus, latestSignalsByComponent } from "./service.js";

void test("system health preserves the most actionable status", () => {
  assert.equal(highestStatus(["healthy", "unknown"]), "unknown");
  assert.equal(highestStatus(["attention", "healthy"]), "attention");
  assert.equal(highestStatus(["attention", "critical"]), "critical");
});

void test("the newest global Temporal result supersedes an old manual result", () => {
  const manual = {
    component: "temporal",
    checkedAt: new Date("2026-09-22T19:18:41Z"),
    status: "healthy",
  };
  const scheduled = {
    component: "temporal",
    checkedAt: new Date("2026-09-23T16:44:25Z"),
    status: "critical",
  };
  assert.equal(
    latestSignalsByComponent([scheduled, manual]).get("temporal"),
    scheduled,
  );
  assert.equal(
    latestSignalsByComponent([manual, scheduled]).get("temporal"),
    scheduled,
  );
});
