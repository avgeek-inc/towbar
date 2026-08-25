import assert from "node:assert/strict";
import test from "node:test";

import { resolveDeploymentQueueBlocker } from "./queue-blocker.js";

const deployment = {
  createdAt: new Date("2026-08-25T17:09:00.000Z"),
  serverId: "server-1",
  state: "queued",
};

void test("reports the earliest server barrier ahead of a queued deployment", () => {
  assert.equal(
    resolveDeploymentQueueBlocker({
      barriers: [
        {
          createdAt: new Date("2026-08-25T17:08:00.000Z"),
          serverId: "server-1",
          type: "server_preparation",
        },
        {
          createdAt: new Date("2026-08-25T17:06:00.000Z"),
          serverId: "server-1",
          type: "server_check",
        },
      ],
      deployment,
    }),
    "server_check",
  );
});

void test("ignores work enqueued after the deployment and work on other servers", () => {
  assert.equal(
    resolveDeploymentQueueBlocker({
      barriers: [
        {
          createdAt: new Date("2026-08-25T17:10:00.000Z"),
          serverId: "server-1",
          type: "server_check",
        },
        {
          createdAt: new Date("2026-08-25T17:05:00.000Z"),
          serverId: "server-2",
          type: "server_operation",
        },
      ],
      deployment,
    }),
    "server_capacity",
  );
});

void test("does not attach a queue blocker after execution starts", () => {
  assert.equal(
    resolveDeploymentQueueBlocker({
      barriers: [
        {
          createdAt: new Date("2026-08-25T17:06:00.000Z"),
          serverId: "server-1",
          type: "server_check",
        },
      ],
      deployment: { ...deployment, state: "waiting_for_server" },
    }),
    null,
  );
});
