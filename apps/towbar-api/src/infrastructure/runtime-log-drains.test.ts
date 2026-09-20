import assert from "node:assert/strict";
import test from "node:test";

import { getRuntimeLogDrains } from "./runtime-log-drains.js";

void test("keeps disabled log drains hidden", () => {
  assert.deepEqual(getRuntimeLogDrains({}), []);
  assert.deepEqual(
    getRuntimeLogDrains({ TOWBAR_LOG_DRAIN_OTLP_ENABLED: "false" }),
    [],
  );
});

void test("requires and validates the complete enabled drain JSON", () => {
  assert.throws(
    () => getRuntimeLogDrains({ TOWBAR_LOG_DRAIN_OTLP_ENABLED: "true" }),
    /TOWBAR_LOG_DRAIN_OTLP_CONFIG_JSON is required/u,
  );
  const [drain] = getRuntimeLogDrains({
    TOWBAR_LOG_DRAIN_OTLP_CONFIG_JSON: JSON.stringify({
      apiKey: "",
      auth: "none",
      caCertificate: "",
      endpoint: "https://otel.example.com",
      headers: [],
      username: "",
    }),
    TOWBAR_LOG_DRAIN_OTLP_ENABLED: "true",
  });
  assert.equal(drain?.provider, "otlp");
  assert.equal(drain?.credential.provider, "otlp");
  assert.equal(drain?.revision.length, 64);
});
