import assert from "node:assert/strict";
import { test } from "node:test";
import { countSourceInventory } from "./source-inventory";

void test("source inventory excludes archived workloads and deduplicates servers across kinds", () => {
  const workload = (
    sourceId: string,
    serverIp: string,
    archivedAt: string | null = null,
  ) => ({ sourceId, serverIp, archivedAt });
  const counts = countSourceInventory(
    [
      workload("one", "192.0.2.1"),
      workload("one", "192.0.2.1"),
      workload("one", "192.0.2.3", "2026-09-01"),
      workload("two", "192.0.2.1"),
    ],
    [
      workload("one", "192.0.2.1"),
      workload("one", "192.0.2.2"),
      workload("two", "192.0.2.4", "2026-09-01"),
    ],
  );
  assert.deepEqual(counts.get("one"), {
    apps: 2,
    resources: 2,
    servers: new Set(["192.0.2.1", "192.0.2.2"]),
  });
  assert.deepEqual(counts.get("two"), {
    apps: 1,
    resources: 0,
    servers: new Set(["192.0.2.1"]),
  });
  assert.equal(countSourceInventory([], []).size, 0);
});
