import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAppSecretBindingDefinitions,
  buildResourceSecretBindingDefinitions,
  buildSourceSharedSecretBindingDefinitions,
  collectDeployableSecretUses,
} from "./secrets.js";

import type { NormalizedApp, NormalizedResource } from "@workspace/towbar-core";

const sharedBuild = "aws:example/shared/build";
const sharedDeployment = "aws:example/shared/deployment";
const appBuild = "aws:example/apps/api/build";
const appDeployment = "aws:example/apps/api/deployment";
const preDeploy = "aws:example/apps/api/pre-deploy";
const previewBuild = "aws:example/apps/api/preview-build";
const previewDeployment = "aws:example/apps/api/preview-deployment";

const app: NormalizedApp = {
  autoDeploy: true,
  container: { port: 4_020 },
  context: ".",
  deploymentInputs: [],
  dockerfile: "apps/api/Dockerfile",
  health: { path: "/health", timeoutSeconds: 30 },
  hooks: {
    preDeploy: {
      command: ["pnpm", "migrate"],
      secrets: preDeploy,
      timeoutSeconds: 300,
    },
  },
  id: "api",
  name: "API",
  preview: {
    domain: "preview.example.com",
    enabled: true,
    secrets: {
      build: previewBuild,
      deployment: previewDeployment,
      hooks: {},
    },
    ttlHours: 72,
  },
  secrets: { build: appBuild, deployment: appDeployment },
  server: "192.0.2.10",
  sharedSecrets: {
    build: [sharedBuild],
    deployment: [sharedDeployment],
  },
  sourceBranch: "main",
};

const resource: NormalizedResource = {
  autoDeploy: true,
  container: {
    command: [],
    port: 5_432,
    resources: { cpus: 1, memory: "1g" },
    volumes: [],
  },
  health: { timeoutSeconds: 30, type: "container" },
  id: "database",
  image: "postgres:18-alpine",
  kind: "postgres",
  name: "Database",
  secrets: { deployment: "aws:example/resources/database/deployment" },
  server: "192.0.2.10",
  sharedSecrets: {
    build: [sharedBuild],
    deployment: [sharedDeployment],
  },
  sourceBranch: "main",
};

void test("collects every effective App secret use without treating Resource build bundles as active", () => {
  assert.deepEqual(collectDeployableSecretUses(app), [
    { reference: sharedBuild, scope: "shared", stage: "build" },
    { reference: appBuild, scope: "app", stage: "build" },
    { reference: preDeploy, scope: "app", stage: "pre_deploy" },
    { reference: previewBuild, scope: "app", stage: "preview_build" },
    {
      reference: previewDeployment,
      scope: "app",
      stage: "preview_deployment",
    },
    {
      reference: sharedDeployment,
      scope: "shared",
      stage: "deployment",
    },
    { reference: appDeployment, scope: "app", stage: "deployment" },
  ]);
  assert.deepEqual(collectDeployableSecretUses(resource), [
    {
      reference: sharedDeployment,
      scope: "shared",
      stage: "deployment",
    },
    {
      reference: "aws:example/resources/database/deployment",
      scope: "app",
      stage: "deployment",
    },
  ]);
});

void test("App bindings contain only App-owned references", () => {
  const bindings = buildAppSecretBindingDefinitions(app, [
    {
      config: app,
      id: "app-record",
      manifestId: app.id,
      name: app.name,
    },
    {
      config: resource,
      id: "resource-record",
      manifestId: resource.id,
      name: resource.name,
    },
  ]);
  assert.deepEqual(
    bindings.map((binding) => binding.reference),
    [appBuild, appDeployment, preDeploy, previewBuild, previewDeployment],
  );
  assert.equal(
    bindings.every((binding) =>
      binding.uses.every((use) => use.scope === "app"),
    ),
    true,
  );
});

void test("Resource bindings contain only the Resource deployment reference", () => {
  const bindings = buildResourceSecretBindingDefinitions(resource, [
    {
      config: app,
      id: "app-record",
      manifestId: app.id,
      name: app.name,
    },
    {
      config: resource,
      id: "resource-record",
      manifestId: resource.id,
      name: resource.name,
    },
  ]);
  assert.deepEqual(
    bindings.map((binding) => binding.reference),
    ["aws:example/resources/database/deployment"],
  );
  assert.deepEqual(bindings[0]?.uses, [{ scope: "app", stage: "deployment" }]);
});

void test("Source bindings contain only shared build and deployment bundles", () => {
  const bindings = buildSourceSharedSecretBindingDefinitions([
    {
      config: app,
      id: "app-record",
      manifestId: app.id,
      name: app.name,
    },
    {
      config: resource,
      id: "resource-record",
      manifestId: resource.id,
      name: resource.name,
    },
  ]);
  assert.deepEqual(
    bindings.map((binding) => binding.reference),
    [sharedBuild, sharedDeployment],
  );
  assert.equal(
    bindings.every((binding) =>
      binding.uses.every((use) => use.scope === "shared"),
    ),
    true,
  );
});
