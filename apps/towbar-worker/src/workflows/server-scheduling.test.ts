import assert from "node:assert/strict";
import test from "node:test";

import { nextServerWorkIndex } from "./server-scheduling.js";

import type { ServerWorkItem } from "./server-scheduling.js";

const deployment = (
  id: string,
  appId: string,
  buildConcurrency = 2,
): ServerWorkItem => ({ appId, buildConcurrency, id, kind: "deployment" });

void test("starts independent app builds up to server concurrency", () => {
  assert.equal(
    nextServerWorkIndex({
      activeAppIds: new Set(["api"]),
      activeCount: 1,
      buildConcurrency: 2,
      queue: [deployment("second-api", "api"), deployment("worker", "worker")],
    }),
    1,
  );
  assert.equal(
    nextServerWorkIndex({
      activeAppIds: new Set(["api", "worker"]),
      activeCount: 2,
      buildConcurrency: 2,
      queue: [deployment("website", "website")],
    }),
    -1,
  );
});

void test("serializes the same app and treats checks as FIFO barriers", () => {
  assert.equal(
    nextServerWorkIndex({
      activeAppIds: new Set(["api"]),
      activeCount: 1,
      buildConcurrency: 3,
      queue: [
        deployment("second-api", "api"),
        { buildConcurrency: 3, id: "check", kind: "server-check" },
        deployment("worker", "worker"),
      ],
    }),
    -1,
  );
  assert.equal(
    nextServerWorkIndex({
      activeAppIds: new Set(),
      activeCount: 0,
      buildConcurrency: 3,
      queue: [{ buildConcurrency: 3, id: "check", kind: "server-check" }],
    }),
    0,
  );
});

void test("serializes resource operations with their deployable and cleanup with the server", () => {
  assert.equal(
    nextServerWorkIndex({
      activeAppIds: new Set(["database"]),
      activeCount: 1,
      buildConcurrency: 2,
      queue: [
        {
          appId: "database",
          buildConcurrency: 2,
          exclusive: false,
          id: "backup",
          kind: "resource-operation",
        },
      ],
    }),
    -1,
  );
  assert.equal(
    nextServerWorkIndex({
      activeAppIds: new Set(),
      activeCount: 0,
      buildConcurrency: 2,
      queue: [
        {
          appId: null,
          buildConcurrency: 2,
          exclusive: true,
          id: "cleanup",
          kind: "resource-operation",
        },
      ],
    }),
    0,
  );
});
