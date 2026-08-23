import assert from "node:assert/strict";
import test from "node:test";

import { type NormalizedDeploymentManifest, digestValue } from "./manifest.js";
import { reconcileManifest } from "./reconciliation.js";

const desired: NormalizedDeploymentManifest = {
  version: 1,
  source: { branch: "main" },
  servers: [
    {
      buildConcurrency: 1,
      ip: "203.0.113.10",
      ssh: { host: "203.0.113.10", port: 22, username: "deploy" },
      secrets: { login: "aws:server/login" },
    },
  ],
  apps: [
    {
      autoDeploy: false,
      id: "app",
      name: "Renamed app",
      server: "203.0.113.10",
      sourceBranch: "main",
      dockerfile: "Dockerfile",
      context: ".",
      deploymentInputs: [],
      container: { port: 3000 },
      dependsOn: [],
      health: { path: "/api/health", timeoutSeconds: 60 },
      hooks: {},
      secrets: {},
    },
  ],
};

void test("uses stable app ids for rename, archive, and restore decisions", () => {
  const currentApp = { ...desired.apps[0]!, name: "Old app name" };
  const currentServer = desired.servers[0]!;
  const result = reconcileManifest({
    currentApps: [
      {
        id: "database-app-id",
        identity: "app",
        archivedAt: null,
        config: currentApp,
        configDigest: digestValue(currentApp),
      },
      {
        id: "database-removed-id",
        identity: "removed",
        archivedAt: null,
        config: { ...currentApp, id: "removed" },
        configDigest: digestValue({ ...currentApp, id: "removed" }),
      },
    ],
    currentServers: [
      {
        archivedAt: null,
        config: currentServer,
        configDigest: digestValue(currentServer),
        id: "database-server-id",
        identity: currentServer.ip,
      },
    ],
    desired,
  });
  assert.equal(
    result.apps.find((entry) => entry.id === "app")?.action,
    "update",
  );
  assert.equal(
    result.apps.find((entry) => entry.id === "app")?.current?.id,
    "database-app-id",
  );
  assert.equal(
    result.apps.find((entry) => entry.id === "removed")?.action,
    "archive",
  );
  assert.equal(result.servers[0]?.action, "unchanged");
  assert.equal(result.servers[0]?.current?.id, "database-server-id");
});

void test("restores an archived record when its identity reappears", () => {
  const app = desired.apps[0]!;
  const result = reconcileManifest({
    currentApps: [
      {
        id: "database-app-id",
        identity: app.id,
        archivedAt: new Date("2026-01-01T00:00:00Z"),
        config: app,
        configDigest: digestValue(app),
      },
    ],
    currentServers: [],
    desired,
  });
  assert.equal(result.apps[0]?.action, "restore");
});

void test("reconciles Resources independently from Apps", () => {
  const resource = {
    autoDeploy: false,
    container: {
      command: [],
      resources: { cpus: 1, memory: "1g" },
      volumes: [{ mountPath: "/var/lib/postgresql/data", name: "data" }],
    },
    dependsOn: [],
    health: {
      command: ["pg_isready"],
      timeoutSeconds: 60,
      type: "command" as const,
    },
    id: "database",
    image: "postgres:17-alpine",
    kind: "postgres" as const,
    name: "Database",
    secrets: {},
    server: "203.0.113.10",
    sharedSecrets: { build: [], deployment: [] },
    sourceBranch: "main",
  };
  const result = reconcileManifest({
    currentApps: [],
    currentResources: [],
    currentServers: [],
    desired: { ...desired, apps: [], resources: [resource] },
  });
  assert.equal(result.resources[0]?.action, "create");
  assert.equal(result.resources[0]?.desired?.id, "database");
});
