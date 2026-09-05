import assert from "node:assert/strict";
import { test } from "node:test";
import {
  allocatedCpuPercent,
  allocatedMemoryPercent,
} from "./allocated-capacity";

void test("CPU usage is relative to allocated cores, including fractional cores", () => {
  assert.equal(allocatedCpuPercent(150, 2), 75);
  assert.equal(allocatedCpuPercent(25, 0.5), 50);
});
void test("memory uses the displayed allocation and supports manifest units", () => {
  assert.equal(allocatedMemoryPercent(700 * 1024 ** 2, "1g"), 68.359375);
  assert.equal(allocatedMemoryPercent(256 * 1024 ** 2, "512M"), 50);
  assert.equal(allocatedMemoryPercent(1024, "2k"), 50);
  assert.equal(allocatedMemoryPercent(512, "1024b"), 50);
  assert.equal(allocatedMemoryPercent(768 * 1024 ** 2, "1.5g"), 50);
});
void test("zero usage differs from unavailable data and over-allocation stays visible", () => {
  assert.equal(allocatedCpuPercent(0, 1), 0);
  assert.equal(allocatedMemoryPercent(0, "1g"), 0);
  assert.equal(allocatedCpuPercent(150, 1), 150);
  assert.equal(allocatedMemoryPercent(2 * 1024 ** 3, "1g"), 200);
  assert.equal(allocatedCpuPercent(null, 1), null);
  assert.equal(allocatedCpuPercent(10, 0), null);
  assert.equal(allocatedMemoryPercent(100, undefined), null);
  assert.equal(allocatedMemoryPercent(100, "invalid"), null);
  assert.equal(allocatedMemoryPercent(-1, "1g"), null);
});
