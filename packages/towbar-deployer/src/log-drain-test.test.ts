import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";

import { logDrainCredentialSchema } from "@workspace/towbar-core";
import {
  buildLogDrainTestConfiguration,
  logDrainTestScript,
} from "./log-drain-test.js";

void describe("log delivery test", () => {
  void it("marks the exact batch for an upstream receipt", () => {
    const testId = "21111111-1111-4111-8111-111111111111";
    const configuration = buildLogDrainTestConfiguration(
      "11111111-1111-4111-8111-111111111111",
      logDrainCredentialSchema.parse({
        provider: "otlp",
        endpoint: "https://collector.example.com/v1/logs",
        auth: "bearer",
        apiKey: "test-only-token",
      }),
      testId,
      "http://127.0.0.1:8787",
    );
    const sink = configuration.sinks.otlp as {
      protocol: { request: { headers: Record<string, string> } };
    };
    assert.equal(
      sink.protocol.request.headers["X-Towbar-Delivery-Test"],
      testId,
    );
    assert.equal("delivery_metrics" in configuration.sources, false);
    assert.equal("receipt_output" in configuration.sinks, false);
  });

  void it("keeps the bounded remote runner valid Bash", () => {
    const result = spawnSync("bash", ["-n"], {
      encoding: "utf8",
      input: logDrainTestScript,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(logDrainTestScript, /test-receipt-\$test_id\.json/u);
    assert.match(logDrainTestScript, /gateway_ready/u);
  });
});
