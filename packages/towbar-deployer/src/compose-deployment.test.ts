import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeDeploymentManifest } from "@workspace/towbar-core";

import { buildComposeServiceOverride } from "./compose-deployment.js";

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
