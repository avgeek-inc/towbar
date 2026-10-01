import assert from "node:assert/strict";
import test from "node:test";

import {
  ManifestValidationError,
  normalizeDeploymentManifest,
} from "@workspace/towbar-core";

import {
  calculateDesiredDeploymentDigest,
  calculateReleaseDeploymentDigest,
} from "./deployment-digests.js";

import type { NormalizedApp, NormalizedServer } from "@workspace/towbar-core";

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
  const first = calculateDesiredDeploymentDigest({
    commitSha: "1".repeat(40),
    deployable: app,
    repositoryTree,
    server,
  });
  const laterUnrelatedCommit = calculateDesiredDeploymentDigest({
    commitSha: "2".repeat(40),
    deployable: app,
    repositoryTree,
    server,
  });
  assert.ok(first);
  assert.deepEqual(first, laterUnrelatedCommit);
});

void test("rejects a complete tree when an app input contract matches nothing", () => {
  assert.throws(
    () =>
      calculateDesiredDeploymentDigest({
        commitSha: "1".repeat(40),
        deployable: { ...app, deploymentInputs: ["apps/missing/**"] },
        repositoryTree,
        server,
      }),
    ManifestValidationError,
  );
});

void test("release digests use the supplied deployment input contract", () => {
  const desired = calculateDesiredDeploymentDigest({
    commitSha: "2".repeat(40),
    deployable: app,
    repositoryTree,
    server,
  });
  const release = calculateReleaseDeploymentDigest({
    commitSha: "1".repeat(40),
    deployable: { ...app, autoDeploy: false, deploymentInputs: [] },
    deploymentInputs: app.deploymentInputs,
    repositoryTree,
    server,
  });
  assert.equal(release.deploymentDigest, desired?.deploymentDigest);
});

void test("datastore file content and runtime overrides participate in deployment digests", () => {
  const resource = normalizeDeploymentManifest({
    version: 2,
    apps: [],
    resources: [
      {
        id: "store",
        name: "Store",
        type: "redis",
        server: server.ip,
        container: {
          configFiles: [
            { source: "config/store.conf", mountPath: "/etc/store.conf" },
          ],
        },
      },
    ],
  }).resources![0]!;
  const tree = {
    complete: true,
    entries: [
      {
        mode: "100644",
        path: "config/store.conf",
        sha: "a".repeat(40),
        type: "blob" as const,
      },
    ],
  };
  const calculate = (
    deployable = resource,
    repositoryTree = tree,
    commitSha = "1".repeat(40),
  ) =>
    calculateDesiredDeploymentDigest({
      deployable,
      repositoryTree,
      commitSha,
      server,
    });
  const first = calculate();
  assert(first.sourceInputDigest);
  assert.deepEqual(first, calculate(resource, tree, "2".repeat(40)));
  assert.notEqual(
    first.deploymentDigest,
    calculate(resource, {
      ...tree,
      entries: [{ ...tree.entries[0]!, sha: "b".repeat(40) }],
    }).deploymentDigest,
  );
  assert.notEqual(
    first.deploymentDigest,
    calculate({
      ...resource,
      container: {
        ...resource.container,
        entrypoint: "/bin/sh",
        command: ["-ec", "exec redis-server /etc/store.conf"],
      },
    }).deploymentDigest,
  );
  assert.throws(
    () => calculate(resource, { complete: true, entries: [] }),
    /regular repository file/,
  );
  const { configFiles: _files, ...container } = resource.container;
  assert.equal(calculate({ ...resource, container }).sourceInputDigest, null);
});
