import assert from "node:assert/strict";
import test from "node:test";

import { highestStatus } from "./service.js";

void test("system health preserves the most actionable status", () => {
  assert.equal(highestStatus(["healthy", "unknown"]), "unknown");
  assert.equal(highestStatus(["attention", "healthy"]), "attention");
  assert.equal(highestStatus(["attention", "critical"]), "critical");
});
