import assert from "node:assert/strict";
import test from "node:test";
import { stringify } from "yaml";

import { normalizeDeploymentManifest } from "./manifest.js";
import { resolveRepositoryEnvironment } from "./manifest-v2.js";
import { selectDeploymentInputEntries } from "./deployment-inputs.js";

const workload = {
  id: "stack",
  name: "Stack",
  server: "192.0.2.10",
  file: "stack/compose.yml",
  overrides: ["stack/production.yml"],
};

void test("Compose booleans retain scheduling behavior and track the whole tree", () => {
  for (const autoDeploy of [undefined, false, true]) {
    const compose = normalizeDeploymentManifest({
      version: 2,
      compose: [{ ...workload, autoDeploy }],
    }).compose![0]!;
    assert.equal(compose.autoDeploy, autoDeploy ?? false);
    assert.deepEqual(compose.deploymentInputs, ["**"]);
  }
});

void test("Compose scopes share service groups and retain mandatory literal files", () => {
  const compose = normalizeDeploymentManifest({
    version: 2,
    deploymentInputs: { shared: ["shared/**"] },
    compose: [
      { ...workload, autoDeploy: { inputs: ["./stack/src/**", "$shared"] } },
    ],
  }).compose![0]!;
  assert.equal(compose.autoDeploy, true);
  assert.deepEqual(compose.deploymentInputs, [
    "shared/**",
    "stack/compose.yml",
    "stack/production.yml",
    "stack/src/**",
  ]);
  const literal = normalizeDeploymentManifest({
    version: 2,
    compose: [
      {
        ...workload,
        file: "stack/[prod].yml",
        overrides: [],
        autoDeploy: { inputs: ["shared/**"] },
      },
    ],
  }).compose![0]!;
  assert.equal(
    selectDeploymentInputEntries(literal.deploymentInputs, {
      complete: true,
      entries: [
        {
          path: "stack/[prod].yml",
          sha: "a".repeat(40),
          mode: "100644",
          type: "blob",
        },
      ],
    }).length,
    1,
  );
});

void test("Compose rejects unsafe, duplicate, empty and undeclared group scopes", () => {
  for (const inputs of [
    ["../escape/**"],
    ["/absolute/**"],
    ["!stack/**"],
    ["stack\\src"],
    [],
    ["stack/**", "stack/**"],
    ["$missing"],
  ]) {
    assert.throws(() =>
      normalizeDeploymentManifest({
        version: 2,
        compose: [{ ...workload, autoDeploy: { inputs } }],
      }),
    );
  }
});

void test("v2 Compose inputs support environment overrides", () => {
  const resolve = (environment: string) =>
    resolveRepositoryEnvironment({
      root: stringify({
        version: 2,
        environments: { production: {}, staging: {} },
      }),
      environment,
      branch: "main",
      files: [
        {
          path: ".towbar/services/stack.compose.yml",
          content: stringify({
            ...workload,
            autoDeploy: { inputs: ["stack/**"] },
            environments: { production: {}, staging: { autoDeploy: false } },
          }),
        },
      ],
    }).manifest.compose![0]!;
  assert.equal(resolve("production").autoDeploy, true);
  assert.deepEqual(resolve("production").deploymentInputs, [
    "stack/**",
    "stack/compose.yml",
    "stack/production.yml",
  ]);
  assert.equal(resolve("staging").autoDeploy, false);
  assert.deepEqual(resolve("staging").deploymentInputs, ["**"]);
});
