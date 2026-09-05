import assert from "node:assert/strict";
import test from "node:test";

import { type NormalizedDeploymentManifest, digestValue } from "./manifest.js";
import { reconcileManifest } from "./reconciliation.js";

const desired: NormalizedDeploymentManifest = {
  version: 1,
  source: { branch: "main" },
  apps: [
    {
      autoDeploy: false,
      vulnerabilityScanning: false,
      id: "app",
      name: "Renamed app",
      server: "203.0.113.10",
      sourceBranch: "main",
      dockerfile: "Dockerfile",
      context: ".",
      deploymentInputs: [],
      container: { port: 3000 },
      health: { path: "/api/health", timeoutSeconds: 60 },
      hooks: {},
    },
  ],
};

void test("uses stable app ids for rename, archive, and restore decisions", () => {
  const currentApp = { ...desired.apps[0]!, name: "Old app name" };
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
    health: {
      command: ["pg_isready"],
      timeoutSeconds: 60,
      type: "command" as const,
    },
    id: "database",
    image: "postgres:17-alpine",
    kind: "postgres" as const,
    name: "Database",

    server: "203.0.113.10",

    sourceBranch: "main",
  };
  const result = reconcileManifest({
    currentApps: [],
    currentResources: [],
    desired: { ...desired, apps: [], resources: [resource] },
  });
  assert.equal(result.resources[0]?.action, "create");
  assert.equal(result.resources[0]?.desired?.id, "database");
});
