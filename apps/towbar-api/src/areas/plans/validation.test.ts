import assert from "node:assert/strict";
import test from "node:test";

import {
  digestValue,
  normalizeDeploymentManifest,
} from "@workspace/towbar-core";

import {
  buildDeploymentPlanValidationChecks,
  buildDeploymentPlanValidationScope,
  parseDockerMemoryBytes,
} from "./validation.js";

const manifest = normalizeDeploymentManifest({
  version: 1,
  source: { branch: "main" },
  servers: [
    {
      ip: "192.0.2.10",

      ssh: { username: "deploy" },
    },
  ],
  apps: [
    {
      id: "website",
      name: "Website",
      server: "192.0.2.10",
      container: { port: 3000 },
      context: ".",
      dockerfile: "Dockerfile",
      health: { path: "/health" },
    },
  ],
});

void test("parses normalized Docker memory limits", () => {
  assert.equal(parseDockerMemoryBytes("512m"), 512 * 1_024 ** 2);
  assert.equal(parseDockerMemoryBytes("1g"), 1_024 ** 3);
});

void test("returns actionable checks without secret values", () => {
  const checks = buildDeploymentPlanValidationChecks({
    context: {
      activeOperationDescriptions: [
        "Wait for the active Source sync to finish",
      ],
      capacities: [],

      existingDomainClaims: [],
      materializedServers: [],
      secretBindings: [
        {
          available: false,
          reference: "Server → Credentials → SSH private key",
        },
      ],
      sourceBranch: "main",
    },
    manifest,
  });
  assert.equal(
    checks.some((check) => check.code === "server_not_materialized"),
    true,
  );
  assert.equal(
    checks.some((check) => check.code === "secret_binding_unavailable"),
    true,
  );
  assert.equal(
    checks.some((check) => check.code === "operation_conflict"),
    true,
  );
  assert.equal(
    checks.find((check) => check.code === "operation_conflict")?.status,
    "warning",
  );
  assert.equal(JSON.stringify(checks).includes("SSH private key"), true);
});

void test("validates only deployables and servers affected by the plan", () => {
  const candidate = normalizeDeploymentManifest({
    version: 1,
    source: { branch: "main" },
    servers: [
      {
        ip: "192.0.2.10",

        ssh: { username: "deploy" },
      },
      {
        ip: "192.0.2.11",

        ssh: { username: "deploy" },
      },
    ],
    apps: [
      {
        id: "website",
        name: "Website",
        server: "192.0.2.10",
        container: { port: 3000 },
        context: ".",
        dockerfile: "Dockerfile",
        health: { path: "/health" },
      },
      {
        id: "unrelated",
        name: "Unrelated",
        server: "192.0.2.11",
        container: { port: 3001 },
        context: ".",
        dockerfile: "Dockerfile",
        health: { path: "/health" },
      },
    ],
  });
  const scope = buildDeploymentPlanValidationScope({
    items: [
      {
        action: "update",
        automaticDeployment: true,
        changedFields: [],
        entityId: "website",
        entityKind: "app",
        matchedPaths: ["apps/website/page.tsx"],
        name: "Website",
        reasons: ["Deployment inputs changed"],
      },
    ],
    manifest: candidate,
  });
  const currentServer = candidate.servers[0]!;
  const currentDigest = digestValue(currentServer);
  const checks = buildDeploymentPlanValidationChecks({
    context: {
      activeOperationDescriptions: [],
      capacities: [],

      existingDomainClaims: [],
      materializedServers: [
        {
          config: currentServer,
          configDigest: currentDigest,
          ip: currentServer.ip,
          preparedAt: new Date(),
          preparedConfigDigest: currentDigest,
        },
      ],
      secretBindings: [
        {
          available: true,
          reference: "Server → Credentials → SSH private key",
        },
      ],
      sourceBranch: "main",
    },
    manifest: candidate,
    scope,
  });

  assert.deepEqual(scope, {
    deployableIds: ["website"],
    serverIps: ["192.0.2.10"],
  });
  assert.equal(
    checks.some((check) =>
      check.references?.includes("Unrelated server credentials"),
    ),
    false,
  );
  assert.equal(
    checks.some((check) => check.entityId === "192.0.2.11"),
    false,
  );
});

void test("warns when declared CPU limits intentionally overcommit the host", () => {
  const candidate = structuredClone(manifest);
  candidate.apps[0]!.container.resources = { cpus: 2, memory: "512m" };
  const currentServer = candidate.servers[0]!;
  const currentDigest = digestValue(currentServer);
  const checks = buildDeploymentPlanValidationChecks({
    context: {
      activeOperationDescriptions: [],
      capacities: [
        {
          checkedAt: new Date().toISOString(),
          cpu: { loadAverage1m: 0.2, logicalCount: 1, usagePercent: 20 },
          disk: null,
          id: "server-1",
          ip: currentServer.ip,
          latestCheckStatus: "succeeded",
          memory: {
            availableBytes: 4_000,
            totalBytes: 8_000,
            usedPercent: 50,
          },
          runtimes: [],
          sourceId: "source-1",
          status: "healthy",
          uptimeSeconds: 3_600,
        },
      ],

      existingDomainClaims: [],
      materializedServers: [
        {
          config: currentServer,
          configDigest: currentDigest,
          ip: currentServer.ip,
          preparedAt: new Date(),
          preparedConfigDigest: currentDigest,
        },
      ],
      secretBindings: [
        {
          available: true,
          reference: "Server → Credentials → SSH private key",
        },
      ],
      sourceBranch: "main",
    },
    manifest: candidate,
  });

  assert.equal(
    checks.find((check) => check.code === "cpu_capacity_exceeded")?.status,
    "warning",
  );
});

void test("blocks secret bindings that cannot be described by name", () => {
  const checks = buildDeploymentPlanValidationChecks({
    context: {
      activeOperationDescriptions: [],
      capacities: [],

      existingDomainClaims: [],
      materializedServers: [],
      secretBindings: [
        {
          available: false,
          reference: "Server → Credentials → SSH private key",
        },
      ],
      sourceBranch: "main",
    },
    manifest,
  });

  assert.deepEqual(
    checks.find((check) => check.code === "secret_binding_unavailable"),
    {
      code: "secret_binding_unavailable",
      entityKind: "source",
      message:
        "Configure Server → Credentials → SSH private key in Towbar settings before execution",
      references: ["Server → Credentials → SSH private key"],
      status: "failed",
    },
  );
});

void test("keeps preparation valid for scheduler-only server changes", () => {
  const currentServer = manifest.servers[0]!;
  const desired = structuredClone(manifest);
  desired.servers[0]!.buildConcurrency = 4;
  const currentDigest = digestValue(currentServer);
  const checks = buildDeploymentPlanValidationChecks({
    context: {
      activeOperationDescriptions: [],
      capacities: [],

      existingDomainClaims: [],
      materializedServers: [
        {
          config: currentServer,
          configDigest: currentDigest,
          ip: currentServer.ip,
          preparedAt: new Date(),
          preparedConfigDigest: currentDigest,
        },
      ],
      secretBindings: [
        {
          available: true,
          reference: "Server → Credentials → SSH private key",
        },
      ],
      sourceBranch: "main",
    },
    manifest: desired,
  });

  assert.equal(
    checks.some((check) => check.code === "server_not_ready"),
    false,
  );
  assert.equal(
    checks.some((check) => check.code === "server_ready"),
    true,
  );
});
