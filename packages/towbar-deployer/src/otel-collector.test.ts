import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildOtlpCollectorConfiguration } from "./otel-collector.js";

import type { OtlpCollectorContext } from "./otel-collector.js";
import type { ProviderConnection } from "@workspace/towbar-core";

const connection = {
  configuration: {
    allowPrivateNetwork: false,
    endpoint: "https://otel.example.com:4318",
    protocol: "http/protobuf",
  },
  credentials: {
    headers: { Authorization: "Bearer fixture-secret" },
  },
  provider: "otlp",
} as Extract<ProviderConnection, { provider: "otlp" }>;

function context(
  input: Partial<OtlpCollectorContext> = {},
): OtlpCollectorContext {
  return {
    cardinalityLimit: 5_000,
    config: {
      buildConcurrency: 1,
      ip: "192.0.2.10",
      ssh: { host: "192.0.2.10", port: 22, username: "deploy" },
    },
    connection,
    connectionSlug: "production-otlp",
    login: { privateKey: "fixture" },
    networks: ["towbar-telemetry-fixture"],
    redactAttributes: ["http.request.header.authorization"],
    sampling: 0.25,
    serverId: "11111111-1111-4111-8111-111111111111",
    signals: ["logs", "metrics", "traces"],
    trustedHostKeys: [],
    ...input,
  } as OtlpCollectorContext;
}

void describe("OTLP collector configuration", () => {
  void it("isolates all three signal exporters with persistent bounded queues", () => {
    const parsed = JSON.parse(buildOtlpCollectorConfiguration(context())) as {
      exporters: Record<
        string,
        {
          compression: string;
          retry_on_failure: Record<string, unknown>;
          sending_queue: {
            block_on_overflow: boolean;
            queue_size: number;
            storage: string;
          };
        }
      >;
      extensions: Record<string, unknown>;
      service: {
        extensions: string[];
        pipelines: Record<string, { exporters: string[] }>;
      };
    };
    assert.deepEqual(Object.keys(parsed.service.pipelines).sort(), [
      "logs",
      "metrics",
      "traces",
    ]);
    assert.deepEqual(Object.keys(parsed.exporters).sort(), [
      "otlphttp/upstream_logs",
      "otlphttp/upstream_metrics",
      "otlphttp/upstream_traces",
    ]);
    for (const [signal, pipeline] of Object.entries(parsed.service.pipelines)) {
      assert.deepEqual(pipeline.exporters, [`otlphttp/upstream_${signal}`]);
      const exporter = parsed.exporters[pipeline.exporters[0]!]!;
      assert.equal(exporter.compression, "gzip");
      assert.equal(exporter.sending_queue.block_on_overflow, false);
      assert.equal(exporter.sending_queue.queue_size, 1_000);
      assert.equal(exporter.sending_queue.storage, "file_storage/queue");
      assert.equal(exporter.retry_on_failure.enabled, true);
    }
    assert.ok(parsed.extensions["file_storage/queue"]);
    assert.deepEqual(parsed.service.extensions, ["file_storage/queue"]);
  });

  void it("applies sampling only to traces and cardinality control only to metrics", () => {
    const parsed = JSON.parse(buildOtlpCollectorConfiguration(context())) as {
      processors: Record<string, unknown>;
      service: {
        pipelines: Record<string, { processors: string[] }>;
      };
    };
    assert.ok(parsed.processors.probabilistic_sampler);
    assert.ok(parsed.processors.cardinality_guardian);
    assert.ok(parsed.processors.attributes);
    assert.equal(
      parsed.service.pipelines.traces!.processors.includes(
        "probabilistic_sampler",
      ),
      true,
    );
    assert.equal(
      parsed.service.pipelines.logs!.processors.includes(
        "probabilistic_sampler",
      ),
      false,
    );
    assert.equal(
      parsed.service.pipelines.metrics!.processors.includes(
        "cardinality_guardian",
      ),
      true,
    );
  });

  void it("emits no collector configuration when no OTLP integration is selected", () => {
    assert.equal(
      buildOtlpCollectorConfiguration(context({ connection: null })),
      "",
    );
  });
});
