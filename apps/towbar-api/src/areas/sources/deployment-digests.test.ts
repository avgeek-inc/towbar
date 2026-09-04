import assert from "node:assert/strict";
import test from "node:test";

import { ManifestValidationError } from "@workspace/towbar-core";

import {
  calculateDesiredDeploymentDigests,
  calculateReleaseDeploymentDigest,
} from "./deployment-digests.js";

import type {
  NormalizedApp,
  NormalizedDeploymentManifest,
  NormalizedServer,
} from "@workspace/towbar-core";

const server = {
  buildConcurrency: 1,
  ip: "203.0.113.10",

  ssh: { host: "203.0.113.10", port: 22, username: "deploy" },
} satisfies NormalizedServer;

const app = {
  autoDeploy: true,
  vulnerabilityScanning: false,
  container: { port: 3_000 },
  context: ".",
  deploymentInputs: ["apps/web/**"],
  dockerfile: "apps/web/Dockerfile",
  health: { path: "/health", timeoutSeconds: 60 },
  hooks: {},
  id: "web",
  kind: "app",
  name: "Web",

  server: server.ip,

  sourceBranch: "main",
} satisfies NormalizedApp;

const manifest = {
  apps: [app],
  resources: [],
  servers: [server],
  source: { branch: "main" },
  version: 1,
} satisfies NormalizedDeploymentManifest;

const repositoryTree = {
  complete: true,
  entries: [
    {
      mode: "100644",
      path: "apps/web/page.tsx",
      sha: "a".repeat(40),
      type: "blob" as const,
    },
  ],
};

void test("materializes stable desired digests from matched repository inputs", () => {
  const first = calculateDesiredDeploymentDigests({
    commitSha: "1".repeat(40),
    manifest,
    repositoryTree,
  }).get("web");
  const laterUnrelatedCommit = calculateDesiredDeploymentDigests({
    commitSha: "2".repeat(40),
    manifest,
    repositoryTree,
  }).get("web");
  assert.ok(first);
  assert.deepEqual(first, laterUnrelatedCommit);
});

void test("rejects a complete tree when an app input contract matches nothing", () => {
  assert.throws(
    () =>
      calculateDesiredDeploymentDigests({
        commitSha: "1".repeat(40),
        manifest: {
          ...manifest,
          apps: [{ ...app, deploymentInputs: ["apps/missing/**"] }],
        },
        repositoryTree,
      }),
    ManifestValidationError,
  );
});

void test("legacy releases can be interpreted with the newly declared input contract", () => {
  const desired = calculateDesiredDeploymentDigests({
    commitSha: "2".repeat(40),
    manifest,
    repositoryTree,
  }).get("web");
  const release = calculateReleaseDeploymentDigest({
    commitSha: "1".repeat(40),
    deployable: { ...app, autoDeploy: false, deploymentInputs: [] },
    deploymentInputs: app.deploymentInputs,
    repositoryTree,
    server,
  });
  assert.equal(release.deploymentDigest, desired?.deploymentDigest);
});
