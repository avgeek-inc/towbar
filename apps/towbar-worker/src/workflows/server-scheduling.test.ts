import assert from "node:assert/strict";
import test from "node:test";

import {
  nextServerWorkIndex,
  serverWorkIdentity,
} from "./server-scheduling.js";

import type { ServerWorkItem } from "./server-scheduling.js";

const deployment = (
  id: string,
  appId: string,
  buildConcurrency = 2,
): Extract<ServerWorkItem, { kind: "deployment" }> => ({
  appId,
  buildConcurrency,
  id,
  kind: "deployment",
});

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

void test("runs server preparation alone and preserves its queue position", () => {
  const preparation: ServerWorkItem = {
    buildConcurrency: 3,
    id: "prepare",
    kind: "server-preparation",
  };
  assert.equal(
    nextServerWorkIndex({
      activeAppIds: new Set(["api"]),
      activeCount: 1,
      buildConcurrency: 3,
      queue: [preparation, deployment("worker", "worker")],
    }),
    -1,
  );
  assert.equal(
    nextServerWorkIndex({
      activeAppIds: new Set(),
      activeCount: 0,
      buildConcurrency: 3,
      queue: [preparation, deployment("worker", "worker")],
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

void test("prioritizes production work over queued Preview builds", () => {
  assert.equal(
    nextServerWorkIndex({
      activeAppIds: new Set(),
      activeCount: 0,
      activePreviewCount: 0,
      buildConcurrency: 3,
      previewBuildConcurrency: 1,
      queue: [
        {
          ...deployment("preview", "website"),
          previewBuildConcurrency: 1,
          priority: "preview",
        },
        { ...deployment("production", "api"), priority: "production" },
      ],
    }),
    1,
  );
});

void test("caps Preview builds independently from production concurrency", () => {
  assert.equal(
    nextServerWorkIndex({
      activeAppIds: new Set(["website"]),
      activeCount: 1,
      activePreviewCount: 1,
      buildConcurrency: 4,
      previewBuildConcurrency: 1,
      queue: [
        {
          ...deployment("preview-admin", "admin"),
          previewBuildConcurrency: 1,
          priority: "preview",
        },
      ],
    }),
    -1,
  );
});

void test("runs vulnerability scans after production and Preview builds and serializes by app", () => {
  const scan: ServerWorkItem = {
    appId: "api",
    buildConcurrency: 3,
    cycle: 1,
    id: "scan",
    kind: "vulnerability-scan",
  };
  assert.equal(
    nextServerWorkIndex({
      activeAppIds: new Set(),
      activeCount: 0,
      buildConcurrency: 3,
      queue: [
        scan,
        { ...deployment("production", "website"), priority: "production" },
      ],
    }),
    1,
  );
  assert.equal(
    nextServerWorkIndex({
      activeAppIds: new Set(["api"]),
      activeCount: 1,
      buildConcurrency: 3,
      queue: [scan],
    }),
    -1,
  );
});

void test("runs at most one vulnerability scan per server", () => {
  const scan: ServerWorkItem = {
    appId: "worker",
    buildConcurrency: 4,
    cycle: 1,
    id: "worker-scan",
    kind: "vulnerability-scan",
  };

  assert.equal(
    nextServerWorkIndex({
      activeAppIds: new Set(["api"]),
      activeCount: 1,
      activeVulnerabilityScanCount: 1,
      buildConcurrency: 4,
      queue: [scan],
    }),
    -1,
  );
  assert.equal(
    nextServerWorkIndex({
      activeAppIds: new Set(["api"]),
      activeCount: 1,
      activeVulnerabilityScanCount: 1,
      buildConcurrency: 4,
      queue: [scan, deployment("website", "website")],
    }),
    1,
  );
});

void test("deduplicates one scan cycle without dropping a controlled rescan", () => {
  const scan: ServerWorkItem = {
    appId: "api",
    buildConcurrency: 2,
    cycle: 1,
    id: "scan",
    kind: "vulnerability-scan",
  };

  assert.equal(serverWorkIdentity(scan), serverWorkIdentity({ ...scan }));
  assert.notEqual(
    serverWorkIdentity(scan),
    serverWorkIdentity({ ...scan, cycle: 2 }),
  );
});

void test("deduplicates repeated Preview signals for one accepted deployment", () => {
  const preview = {
    ...deployment("preview-deployment", "website"),
    previewBuildConcurrency: 1,
    priority: "preview" as const,
  };

  assert.equal(serverWorkIdentity(preview), serverWorkIdentity({ ...preview }));
  assert.notEqual(
    serverWorkIdentity(preview),
    serverWorkIdentity({ ...preview, id: "next-preview-deployment" }),
  );
});
