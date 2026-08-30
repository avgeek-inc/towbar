import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateMaintenanceWindow,
  validateAutoDeployMaintenanceWindow,
} from "./auto-deploy-controls.js";

const weekdayWindow = {
  daysOfWeek: [1, 2, 3, 4, 5],
  endMinute: 17 * 60,
  startMinute: 9 * 60,
  timezone: "America/New_York",
};

void test("evaluates a timezone-aware maintenance window", () => {
  assert.deepEqual(
    evaluateMaintenanceWindow(
      weekdayWindow,
      new Date("2026-03-09T14:30:00.000Z"),
    ),
    { nextOpenAt: null, open: true },
  );
  assert.deepEqual(
    evaluateMaintenanceWindow(
      weekdayWindow,
      new Date("2026-03-09T12:00:00.000Z"),
    ),
    { nextOpenAt: "2026-03-09T13:00:00.000Z", open: false },
  );
});

void test("keeps the same local opening time across DST", () => {
  assert.equal(
    evaluateMaintenanceWindow(
      weekdayWindow,
      new Date("2026-03-06T23:00:00.000Z"),
    ).nextOpenAt,
    "2026-03-09T13:00:00.000Z",
  );
  assert.equal(
    evaluateMaintenanceWindow(
      weekdayWindow,
      new Date("2026-10-30T23:00:00.000Z"),
    ).nextOpenAt,
    "2026-11-02T14:00:00.000Z",
  );
});

void test("supports windows that cross midnight", () => {
  const overnight = {
    daysOfWeek: [1],
    endMinute: 2 * 60,
    startMinute: 22 * 60,
    timezone: "UTC",
  };
  assert.equal(
    evaluateMaintenanceWindow(overnight, new Date("2026-08-24T23:00:00Z")).open,
    true,
  );
  assert.equal(
    evaluateMaintenanceWindow(overnight, new Date("2026-08-25T01:00:00Z")).open,
    true,
  );
});

void test("rejects invalid maintenance-window configuration", () => {
  assert.throws(() =>
    validateAutoDeployMaintenanceWindow({
      ...weekdayWindow,
      timezone: "Not/A_Zone",
    }),
  );
  assert.throws(() =>
    validateAutoDeployMaintenanceWindow({ ...weekdayWindow, daysOfWeek: [] }),
  );
});
