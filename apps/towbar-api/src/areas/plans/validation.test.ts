import assert from "node:assert/strict";
import test from "node:test";

import {
  digestValue,
  normalizeDeploymentManifest,
} from "@workspace/towbar-core";

import {
  buildDeploymentPlanValidationChecks,
  buildDeploymentPlanValidationScope,
  collectPlanSecretReferences,
  collectSecretReferences,
  parseDockerMemoryBytes,
} from "./validation.js";

const manifest = normalizeDeploymentManifest({
  version: 1,
  source: { branch: "main" },
  servers: [
    {
      ip: "192.0.2.10",
      secrets: { login: "aws:source/server-login" },
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

void test("collects sorted secret names without resolving values", () => {
  assert.deepEqual(
    collectSecretReferences({ second: "aws:z", first: ["aws:a", "plain"] }),
    ["aws:a", "aws:z"],
  );
});

void test("does not require shared runtime secrets for an archive-only plan", () => {
  const candidate = normalizeDeploymentManifest({
    version: 1,
    source: { branch: "main" },
    secrets: { deployment: ["aws:source/shared-runtime"] },
    servers: [
      {
        ip: "192.0.2.10",
        secrets: { login: "aws:source/server-login" },
        ssh: { username: "deploy" },
      },
    ],
    apps: [
      {
        id: "retained-app",
        name: "Retained app",
        server: "192.0.2.10",
        container: { port: 3000 },
        context: ".",
        dockerfile: "Dockerfile",
        health: { path: "/health" },
      },
    ],
  });

  assert.deepEqual(
    collectPlanSecretReferences(candidate, {
      deployableIds: ["archived-app"],
      serverIps: [],
    }),
    [],
  );
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
      credentialStatus: null,
      existingDomainClaims: [],
      materializedServers: [],
      secretBindings: [],
      sourceBranch: "main",
    },
    manifest,
  });
  assert.equal(
    checks.some((check) => check.code === "server_not_materialized"),
    true,
  );
  assert.equal(
    checks.some((check) => check.code === "secret_bindings_unavailable"),
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
  assert.equal(JSON.stringify(checks).includes("server-login"), true);
});

void test("validates only deployables and servers affected by the plan", () => {
  const candidate = normalizeDeploymentManifest({
    version: 1,
    source: { branch: "main" },
    servers: [
      {
        ip: "192.0.2.10",
        secrets: { login: "aws:source/server-login" },
        ssh: { username: "deploy" },
      },
      {
        ip: "192.0.2.11",
        secrets: { login: "aws:source/unrelated-login" },
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
      credentialStatus: "verified",
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
        { available: true, reference: "aws:source/server-login" },
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
      check.references?.includes("aws:source/unrelated-login"),
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
      credentialStatus: "verified",
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
        { available: true, reference: "aws:source/server-login" },
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
      credentialStatus: "verified",
      existingDomainClaims: [],
      materializedServers: [],
      secretBindings: [
        { available: false, reference: "aws:source/server-login" },
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
        "Secret binding 'aws:source/server-login' was not found or cannot be described by the Source AWS credentials",
      references: ["aws:source/server-login"],
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
      credentialStatus: "verified",
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
        { available: true, reference: "aws:source/server-login" },
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
