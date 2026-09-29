import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";

import { normalizeDeploymentManifest } from "@workspace/towbar-core";

import {
  buildComposeServiceOverride,
  composeDeploymentScripts,
} from "./compose-deployment.js";

void describe("Compose remote scripts", () => {
  for (const [name, script] of Object.entries(composeDeploymentScripts)) {
    void it(`${name} parses as Bash`, () => {
      const result = spawnSync("bash", ["-n"], {
        encoding: "utf8",
        input: script,
      });
      assert.equal(result.status, 0, `${name}: ${result.stderr}`);
    });
  }
});

function workload() {
  const manifest = normalizeDeploymentManifest({
    version: 2,
    compose: [
      {
        id: "platform",
        name: "Platform",
        server: "192.0.2.10",
        file: "compose.yml",
        services: {
          api: { domains: ["api.example.com"], port: 3000 },
          worker: {},
        },
      },
    ],
  });
  return manifest.compose![0]!;
}

void describe("Compose override", () => {
  void it("adds managed labels and declared ports without injecting environment settings", () => {
    const override = buildComposeServiceOverride(workload(), "production");
    assert.equal(override.services.api?.labels["towbar.managed"], "true");
    assert.deepEqual(override.services.api?.ports, ["127.0.0.1::3000"]);
    assert.equal("environment" in override.services.api!, false);
    assert.equal("environment" in override.services.worker!, false);
  });
});
