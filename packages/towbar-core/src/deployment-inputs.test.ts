import assert from "node:assert/strict";
import test from "node:test";

import {
  getDeployableDeploymentDigest,
  getSourceInputDigest,
} from "./deployment-inputs.js";

import type { NormalizedApp, NormalizedServer } from "./manifest.js";

const tree = {
  complete: true,
  entries: [
    {
      mode: "100644",
      path: "apps/api/src/index.ts",
      sha: "api-v1",
      type: "blob" as const,
    },
    {
      mode: "100644",
      path: "apps/web/src/page.tsx",
      sha: "web-v1",
      type: "blob" as const,
    },
  ],
};

void test("hashes only selected repository inputs", () => {
  const initial = getSourceInputDigest({
    commitSha: "commit-one",
    deploymentInputs: ["apps/api/**"],
    tree,
  });
  const unrelatedChange = getSourceInputDigest({
    commitSha: "commit-two",
    deploymentInputs: ["apps/api/**"],
    tree: {
      ...tree,
      entries: tree.entries.map((entry) =>
        entry.path.startsWith("apps/web/")
          ? { ...entry, sha: "web-v2" }
          : entry,
      ),
    },
  });
  assert.equal(initial.fallback, false);
  assert.deepEqual(initial.matchedPaths, ["apps/api/src/index.ts"]);
  assert.equal(initial.digest, unrelatedChange.digest);
});

void test("falls back to the commit when no path contract is configured or the tree is incomplete", () => {
  assert.notEqual(
    getSourceInputDigest({
      commitSha: "commit-one",
      deploymentInputs: [],
      tree,
    }).digest,
    getSourceInputDigest({
      commitSha: "commit-two",
      deploymentInputs: [],
      tree,
    }).digest,
  );
  assert.equal(
    getSourceInputDigest({
      commitSha: "commit-one",
      deploymentInputs: ["apps/api/**"],
      tree: { complete: false, entries: [] },
    }).fallback,
    true,
  );
});

void test("deployment metadata and scheduling controls do not change the runtime digest", () => {
  const app = {
    autoDeploy: true,
    container: { port: 3_000 },
    context: ".",
    dependsOn: [],
    deploymentInputs: ["apps/web/**"],
    dockerfile: "apps/web/Dockerfile",
    health: { path: "/health", timeoutSeconds: 60 },
    hooks: {},
    id: "web",
    kind: "app",
    name: "Web",
    secrets: {},
    server: "203.0.113.10",
    sharedSecrets: { build: [], deployment: [] },
    sourceBranch: "main",
  } satisfies NormalizedApp;
  const server = {
    buildConcurrency: 1,
    ip: "203.0.113.10",
    secrets: { login: "aws:example/server/login" },
    ssh: { host: "203.0.113.10", port: 22, username: "deploy" },
  } satisfies NormalizedServer;
  const digest = getDeployableDeploymentDigest({
    deployable: app,
    server,
    sourceInputDigest: "source",
  });
  assert.equal(
    digest,
    getDeployableDeploymentDigest({
      deployable: {
        ...app,
        autoDeploy: false,
        dependsOn: ["api"],
        description: "Display-only description",
        deploymentInputs: ["packages/shared/**"],
        name: "Renamed Web",
        sourceBranch: "release",
      },
      server: { ...server, buildConcurrency: 8 },
      sourceInputDigest: "source",
    }),
  );
});
