import assert from "node:assert/strict";
import test from "node:test";

import { shouldQueueMaintenanceServerCheck } from "./maintenance.js";

const now = new Date("2026-08-25T17:30:00.000Z");

void test("queues the first maintenance check only when the server queue is idle", () => {
  assert.equal(
    shouldQueueMaintenanceServerCheck({
      hasPendingServerWork: false,
      latestCheck: undefined,
      now,
    }),
    true,
  );
  assert.equal(
    shouldQueueMaintenanceServerCheck({
      hasPendingServerWork: true,
      latestCheck: undefined,
      now,
    }),
    false,
  );
});

void test("defers stale checks while deployments or operations are pending", () => {
  assert.equal(
    shouldQueueMaintenanceServerCheck({
      hasPendingServerWork: true,
      latestCheck: {
        createdAt: new Date("2026-08-25T17:20:00.000Z"),
        status: "succeeded",
      },
      now,
    }),
    false,
  );
});

void test("queues only completed checks that are at least five minutes old", () => {
  for (const status of ["queued", "running"] as const) {
    assert.equal(
      shouldQueueMaintenanceServerCheck({
        hasPendingServerWork: false,
        latestCheck: {
          createdAt: new Date("2026-08-25T17:20:00.000Z"),
          status,
        },
        now,
      }),
      false,
    );
  }
  assert.equal(
    shouldQueueMaintenanceServerCheck({
      hasPendingServerWork: false,
      latestCheck: {
        createdAt: new Date("2026-08-25T17:25:00.001Z"),
        status: "failed",
      },
      now,
    }),
    false,
  );
  assert.equal(
    shouldQueueMaintenanceServerCheck({
      hasPendingServerWork: false,
      latestCheck: {
        createdAt: new Date("2026-08-25T17:25:00.000Z"),
        status: "succeeded",
      },
      now,
    }),
    true,
  );
});
