import assert from "node:assert/strict";
import test from "node:test";

import { digestValue, normalizeDeploymentManifest } from "./manifest.js";
import {
  buildBlockedDeploymentPlan,
  buildDeploymentPlan,
  changedFieldPaths,
} from "./deployment-plan.js";

const manifest = normalizeDeploymentManifest({
  version: 1,
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
      autoDeploy: { inputs: ["apps/website/**"] },
      container: { port: 3000 },
      context: ".",
      dockerfile: "apps/website/Dockerfile",
      domains: { primary: "example.test" },
      health: { path: "/health" },
    },
  ],
});

const currentServer = {
  archivedAt: null,
  config: manifest.servers[0]!,
  configDigest: digestValue(manifest.servers[0]),
  id: "server-id",
  identity: "192.0.2.10",
};
const currentApp = {
  archivedAt: null,
  config: manifest.apps[0]!,
  configDigest: digestValue(manifest.apps[0]),
  deploymentDigest: "old-digest",
  id: "app-id",
  identity: "website",
};

void test("builds a deterministic full plan with explicit no-op rows", () => {
  const input = {
    currentApps: [currentApp],
    currentResources: [],
    currentServers: [currentServer],
    desired: manifest,
    mode: "full" as const,
    targetDeploymentDigests: new Map([["website", "old-digest"]]),
  };
  const first = buildDeploymentPlan(input);
  const second = buildDeploymentPlan(input);

  assert.deepEqual(first, second);
  assert.deepEqual(first.summary, {
    archive: 0,
    create: 0,
    no_op: 2,
    restore: 0,
    update: 0,
  });
  assert.deepEqual(
    first.items.map(({ action, entityId, entityKind }) => ({
      action,
      entityId,
      entityKind,
    })),
    [
      { action: "no_op", entityId: "website", entityKind: "app" },
      { action: "no_op", entityId: "192.0.2.10", entityKind: "server" },
    ],
  );
});

void test("promotes a matching pull request path to an update", () => {
  const plan = buildDeploymentPlan({
    currentApps: [currentApp],
    currentResources: [],
    currentServers: [currentServer],
    desired: manifest,
    mode: "pull_request",
    repositoryChanges: {
      complete: true,
      paths: ["README.md", "apps/website/src/page.tsx"],
    },
    targetDeploymentDigests: new Map([["website", "new-digest"]]),
  });

  assert.deepEqual(plan.items, [
    {
      action: "update",
      automaticDeployment: true,
      changedFields: [],
      entityId: "website",
      entityKind: "app",
      matchedPaths: ["apps/website/src/page.tsx"],
      name: "Website",
      reasons: ["Changed paths match this deployable's deployment inputs"],
    },
  ]);
});

void test("omits irrelevant pull request no-op rows", () => {
  const plan = buildDeploymentPlan({
    currentApps: [currentApp],
    currentResources: [],
    currentServers: [currentServer],
    desired: manifest,
    mode: "pull_request",
    repositoryChanges: { complete: true, paths: ["README.md"] },
    targetDeploymentDigests: new Map([["website", "old-digest"]]),
  });

  assert.deepEqual(plan.items, []);
  assert.equal(plan.status, "skipped");
  assert.deepEqual(plan.summary, {
    archive: 0,
    create: 0,
    no_op: 0,
    restore: 0,
    update: 0,
  });
});

void test("skips pull request plans that contain only no-op rows", () => {
  const plan = buildDeploymentPlan({
    currentApps: [currentApp],
    currentResources: [],
    currentServers: [currentServer],
    desired: manifest,
    mode: "pull_request",
    repositoryChanges: {
      complete: true,
      paths: ["apps/website/src/page.tsx"],
    },
    targetDeploymentDigests: new Map([["website", "old-digest"]]),
  });

  assert.equal(plan.status, "skipped");
  assert.deepEqual(plan.summary, {
    archive: 0,
    create: 0,
    no_op: 1,
    restore: 0,
    update: 0,
  });
});

void test("reports changed fields without returning field values", () => {
  assert.deepEqual(
    changedFieldPaths(
      { domains: { primary: "old.example" }, secrets: { build: "old" } },
      { domains: { primary: "new.example" }, secrets: { build: "new" } },
    ),
    ["domains.primary", "secrets.build"],
  );
});

void test("sorts blocking checks and exposes no mutable inventory", () => {
  const plan = buildBlockedDeploymentPlan([
    { code: "warning", message: "Warning", status: "warning" },
    { code: "schema", message: "Invalid", status: "failed" },
  ]);
  assert.equal(plan.status, "blocked");
  assert.equal(plan.checks[0]?.code, "schema");
  assert.deepEqual(plan.items, []);
});
