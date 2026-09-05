import assert from "node:assert/strict";
import { test } from "node:test";
import { serverHardwareFromCheck } from "./server-hardware.js";

void test("old persisted checks retain hardware capacity without cloud metadata", () => {
  assert.deepEqual(
    serverHardwareFromCheck({
      host: { cpuLogicalCount: 6, memoryTotalKb: 134217728 },
    }),
    {
      instance: null,
      cpuCount: 6,
      memoryBytes: 137438953472,
    },
  );
});
void test("saved instance type takes its provider and size from metadata", () => {
  assert.deepEqual(
    serverHardwareFromCheck({
      host: {
        instance: { provider: "aws", type: "r6a.xlarge" },
        cpuLogicalCount: 4,
        memoryTotalKb: 33554432,
      },
    }),
    {
      instance: { provider: "aws", type: "r6a.xlarge" },
      cpuCount: 4,
      memoryBytes: 34359738368,
    },
  );
});
void test("bad or absent metadata does not discard usable capacity", () => {
  assert.equal(serverHardwareFromCheck(null), null);
  assert.deepEqual(
    serverHardwareFromCheck({
      host: {
        instance: { provider: "unknown", type: "<html>" },
        cpuLogicalCount: 0,
        memoryTotalKb: 1024,
      },
    }),
    {
      instance: null,
      cpuCount: null,
      memoryBytes: 1048576,
    },
  );
});
