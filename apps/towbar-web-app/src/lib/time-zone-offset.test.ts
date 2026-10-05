import assert from "node:assert/strict";
import test from "node:test";
import { timeZoneOffset } from "./time-zone-offset";

void test("offset labels handle zero, half-hour and quarter-hour zones without a prefix", () => {
  const instant = new Date("2026-10-05T00:00:00Z");
  assert.equal(timeZoneOffset("UTC", instant), "+00:00");
  assert.equal(timeZoneOffset("Asia/Kolkata", instant), "+05:30");
  assert.equal(timeZoneOffset("Asia/Kathmandu", instant), "+05:45");
  assert.equal(timeZoneOffset("Australia/Eucla", instant), "+08:45");
});

void test("offset labels follow daylight saving at the supplied instant", () => {
  const winter = new Date("2026-01-15T00:00:00Z");
  const summer = new Date("2026-07-15T00:00:00Z");
  assert.equal(timeZoneOffset("America/New_York", winter), "−05:00");
  assert.equal(timeZoneOffset("America/New_York", summer), "−04:00");
  assert.equal(timeZoneOffset("Australia/Lord_Howe", winter), "+11:00");
  assert.equal(timeZoneOffset("Australia/Lord_Howe", summer), "+10:30");
});
