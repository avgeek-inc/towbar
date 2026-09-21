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
          api: {
            telemetry: {
              integration: "production-otlp",
              signals: ["logs", "metrics", "traces"],
              protocol: "otlp-http",
              sampling: 0.25,
              cardinalityLimit: 5_000,
            },
          },
          worker: {},
        },
      },
    ],
  });
  return manifest.compose![0]!;
}

void describe("Compose telemetry override", () => {
  void it("injects the managed collector endpoint and complete resource identity only into opted-in services", () => {
    const override = buildComposeServiceOverride(
      workload(),
      "production",
      "11111111-1111-4111-8111-111111111111",
      {
        deployableId: "21111111-1111-4111-8111-111111111111",
        deploymentId: "31111111-1111-4111-8111-111111111111",
        serverId: "41111111-1111-4111-8111-111111111111",
        workspaceId: "51111111-1111-4111-8111-111111111111",
      },
    );
    const api = override.services.api!;
    const worker = override.services.worker!;
    assert.equal(
      api.environment?.OTEL_EXPORTER_OTLP_ENDPOINT,
      "http://towbar-otel:4318",
    );
    assert.equal(api.environment?.OTEL_EXPORTER_OTLP_PROTOCOL, "http/protobuf");
    assert.equal(api.environment?.OTEL_TRACES_SAMPLER_ARG, "0.25");
    assert.match(
      api.environment?.OTEL_RESOURCE_ATTRIBUTES ?? "",
      /deployment\.environment\.name=production/u,
    );
    assert.match(
      api.environment?.OTEL_RESOURCE_ATTRIBUTES ?? "",
      /towbar\.compose\.service=api/u,
    );
    assert.match(
      api.environment?.OTEL_RESOURCE_ATTRIBUTES ?? "",
      /towbar\.team\.id=51111111-1111-4111-8111-111111111111/u,
    );
    assert.equal("environment" in worker, false);
  });
});
