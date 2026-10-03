import assert from "node:assert/strict";
import test from "node:test";
import {
  ManifestValidationError,
  normalizeDeploymentManifest,
} from "@workspace/towbar-core";
import type {
  NormalizedComposeWorkload,
  RepositoryTree,
} from "@workspace/towbar-core";

import {
  calculateDesiredDeploymentDigest,
  calculateReleaseDeploymentDigest,
} from "./deployment-digests.js";

const server = {
  buildConcurrency: 1,
  ip: "192.0.2.10",
  ssh: { host: "192.0.2.10", port: 22, username: "deploy" },
};
const entry = (path: string, sha = "a".repeat(40), mode = "100644") => ({
  path,
  sha,
  mode,
  type: "blob" as const,
});
const issue = (message: string) => (error: unknown) =>
  error instanceof ManifestValidationError &&
  error.issues.some((issue) => issue.message.includes(message));
const tree: RepositoryTree = {
  complete: true,
  entries: [
    entry("stack/compose.yml"),
    entry("stack/production.yml"),
    entry("stack/config/collector.yml"),
    entry("stack/src/server.js"),
    entry("stack/.dockerignore"),
    entry("shared/included.yml"),
    entry("README.md"),
  ],
};
function compose(inputs?: string[]) {
  return normalizeDeploymentManifest({
    version: 2,
    compose: [
      {
        id: "stack",
        name: "Stack",
        server: server.ip,
        file: "stack/compose.yml",
        overrides: ["stack/production.yml"],
        autoDeploy: inputs ? { inputs } : true,
      },
    ],
  }).compose![0]!;
}
function calculate(
  deployable = compose(),
  repositoryTree = tree,
  commitSha = "a".repeat(40),
) {
  return calculateDesiredDeploymentDigest({
    deployable,
    repositoryTree,
    commitSha,
    server,
  });
}

void test("default Compose tracking catches all source changes but ignores empty commits", async (t) => {
  const before = calculate();
  assert.deepEqual(before, calculate(compose(), tree, "b".repeat(40)));
  for (const path of tree.entries.map((entry) => entry.path)) {
    await t.test(path, () => {
      assert.notEqual(
        before.deploymentDigest,
        calculate(compose(), {
          ...tree,
          entries: tree.entries.map((entry) =>
            entry.path === path ? { ...entry, sha: "b".repeat(40) } : entry,
          ),
        }).deploymentDigest,
      );
    });
  }
  for (const entries of [
    [...tree.entries, entry("stack/config/new.yml")],
    tree.entries.filter((entry) => entry.path !== "stack/config/collector.yml"),
    tree.entries.map((entry) =>
      entry.path === "shared/included.yml"
        ? { ...entry, path: "shared/renamed.yml" }
        : entry,
    ),
    tree.entries.map((entry) =>
      entry.path === "stack/src/server.js"
        ? { ...entry, mode: "100755" }
        : entry,
    ),
  ])
    assert.notEqual(
      before.deploymentDigest,
      calculate(compose(), { ...tree, entries }).deploymentDigest,
    );
});

void test("Compose scopes skip unrelated files and always include Compose files", () => {
  const workload = compose(["stack/src/**"]);
  const before = calculate(workload);
  for (const path of [
    "stack/compose.yml",
    "stack/production.yml",
    "stack/src/server.js",
  ]) {
    assert.notEqual(
      before.deploymentDigest,
      calculate(workload, {
        ...tree,
        entries: tree.entries.map((entry) =>
          entry.path === path ? { ...entry, sha: "b".repeat(40) } : entry,
        ),
      }).deploymentDigest,
    );
  }
  assert.deepEqual(
    before,
    calculate(
      workload,
      {
        ...tree,
        entries: tree.entries.map((entry) =>
          entry.path === "README.md"
            ? { ...entry, sha: "b".repeat(40) }
            : entry,
        ),
      },
      "b".repeat(40),
    ),
  );
});

void test("Compose digests fail closed on missing trees or mandatory non-regular files", () => {
  const deployable = compose();
  assert.throws(
    () =>
      calculateDesiredDeploymentDigest({
        deployable,
        server,
        commitSha: "a".repeat(40),
      }),
    issue("complete repository tree"),
  );
  assert.throws(
    () => calculate(deployable, { ...tree, complete: false }),
    issue("complete repository tree"),
  );
  for (const path of [deployable.file, ...deployable.overrides]) {
    assert.throws(
      () =>
        calculate(deployable, {
          ...tree,
          entries: tree.entries.filter((entry) => entry.path !== path),
        }),
      issue("regular file"),
    );
    assert.throws(
      () =>
        calculate(deployable, {
          ...tree,
          entries: tree.entries.map((entry) =>
            entry.path === path ? { ...entry, mode: "120000" } : entry,
          ),
        }),
      issue("regular file"),
    );
  }
});

void test("Compose release digests honor captured inputs rather than later scope changes", () => {
  const admitted = compose(["stack/src/**"]);
  const desired = calculate(admitted);
  const release = calculateReleaseDeploymentDigest({
    commitSha: "b".repeat(40),
    deployable: {
      ...admitted,
      autoDeploy: false,
      deploymentInputs: ["**"],
    } satisfies NormalizedComposeWorkload,
    deploymentInputs: admitted.deploymentInputs,
    repositoryTree: tree,
    server,
  });
  assert.equal(release.deploymentDigest, desired.deploymentDigest);
  assert.equal(release.sourceInputDigest, desired.sourceInputDigest);
});
