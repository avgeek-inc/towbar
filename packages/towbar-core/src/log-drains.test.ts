import assert from "node:assert/strict";
import test from "node:test";
import { stringify } from "yaml";
import { normalizeDeploymentManifest } from "./manifest.js";
import {
  logDrainCredentialSchema,
  logDrainEndpoint,
  logDrainProviders,
  logDrainPublicConfiguration,
  logDrainSecret,
  logDrainsSchema,
  mergeLogDrainCredential,
} from "./log-drains.js";
import { resolveRepositoryEnvironment } from "./manifest-v2.js";
void test("log manifests select team destinations, replace environment lists and reject inline credentials", () => {
  const resolve = (logDrains: unknown, override?: unknown) =>
    resolveRepositoryEnvironment({
      branch: "main",
      environment: override === undefined ? "production" : "staging",
      root: stringify({
        version: 2,
        environments: { production: {}, staging: {} },
      }),
      files: [
        {
          path: ".towbar/apps/web.app.yml",
          content: stringify({
            id: "web",
            name: "Website",
            dockerfile: "Dockerfile",
            container: { port: 3000 },
            logDrains,
            environments: {
              production: { server: "192.0.2.10" },
              staging: { server: "192.0.2.11", logDrains: override ?? [] },
            },
          }),
        },
      ],
    });
  assert.deepEqual(resolve(["newrelic", "axiom"]).manifest.apps[0]!.logDrains, [
    "axiom",
    "newrelic",
  ]);
  assert.equal(resolve(["axiom"], []).manifest.apps[0]!.logDrains, undefined);
  for (const invalid of [
    ["axiom", "axiom"],
    ["unsupported"],
    [{ provider: "axiom", apiKey: "inline" }],
    { provider: "axiom" },
  ])
    assert.throws(() => resolve(invalid));
});
void test("log destinations enforce provider-owned HTTPS endpoints and reject injected credentials", () => {
  const valid = {
    provider: "axiom",
    apiKey: "test_token_1234",
    dataset: "production",
    ingestHost: "us-east-1.aws.edge.axiom.co",
  };
  assert.equal(
    logDrainEndpoint(logDrainCredentialSchema.parse(valid)).url,
    "https://us-east-1.aws.edge.axiom.co/v1/ingest/production",
  );
  for (const ingestHost of [
    "127.0.0.1",
    "169.254.169.254",
    "us.edge.axiom.co.evil.test",
    "user@us.edge.axiom.co",
    "us.edge.axiom.co/path",
    "us.edge.axiom.co:80",
  ])
    assert.throws(() =>
      logDrainCredentialSchema.parse({ ...valid, ingestHost }),
    );
  for (const apiKey of [
    "short",
    "Bearer bad",
    "key\r\nInjected: value",
    "token_{{message}}",
  ])
    assert.throws(() => logDrainCredentialSchema.parse({ ...valid, apiKey }));
  assert.throws(() =>
    logDrainCredentialSchema.parse({ ...valid, endpoint: "http://private" }),
  );
});

void test("resources preserve their normalized log destinations", () => {
  const manifest = normalizeDeploymentManifest({
    version: 2,
    resources: [
      {
        id: "redis",
        name: "Redis",
        type: "redis",
        server: "192.0.2.10",
        logDrains: ["datadog", "axiom"],
      },
    ],
  });
  assert.deepEqual(manifest.resources![0]!.logDrains, ["axiom", "datadog"]);
});

void test("custom destinations require HTTPS and validate authentication and header boundaries", () => {
  const base = {
    provider: "otlp",
    endpoint: "https://collector.internal:4318/v1/logs",
    auth: "none",
  };
  assert.equal(logDrainCredentialSchema.parse(base).provider, "otlp");
  const certificate = [
    "-----BEGIN CERTIFICATE-----",
    "QUJDRA==",
    "-----END CERTIFICATE-----",
  ].join("\n");
  assert.doesNotThrow(() =>
    logDrainCredentialSchema.parse({ ...base, caCertificate: certificate }),
  );
  assert.doesNotThrow(() =>
    logDrainCredentialSchema.parse({
      ...base,
      caCertificate: `${certificate}\n${certificate}`,
    }),
  );
  for (const endpoint of [
    "http://collector/v1/logs",
    "file:///etc/passwd",
    "https://user:secret@collector/v1/logs",
    "https://collector/v1/logs?token=secret",
    "https://collector/v1/logs#fragment",
    "https://collector/{{message}}",
    "https://collector\\evil/v1/logs",
    "https://collector/\nlogs",
  ])
    assert.throws(
      () => logDrainCredentialSchema.parse({ ...base, endpoint }),
      endpoint,
    );
  for (const change of [
    { auth: "bearer" },
    { auth: "bearer", apiKey: "invalid token" },
    { auth: "basic", apiKey: "password" },
    { auth: "basic", username: "user:bad", apiKey: "password" },
    { auth: "headers", headers: [] },
    { auth: "none", apiKey: "unused-token" },
    { auth: "none", username: "unused" },
    {
      auth: "headers",
      headers: [{ name: "X-Key", value: "key\r\ninjected: yes" }],
    },
    {
      auth: "headers",
      headers: [{ name: "X-Key", value: "{{message}}" }],
    },
    {
      auth: "headers",
      headers: [
        { name: "X-Key", value: "one" },
        { name: "x-key", value: "two" },
      ],
    },
    { caCertificate: "/etc/passwd" },
    {
      caCertificate:
        "-----BEGIN CERTIFICATE-----\nnot base64!\n-----END CERTIFICATE-----",
    },
  ])
    assert.throws(() => logDrainCredentialSchema.parse({ ...base, ...change }));
  for (const name of [
    "Host",
    "Content-Type",
    "Content-Length",
    "Content-Encoding",
    "Connection",
    "Transfer-Encoding",
    "Cookie",
    "Proxy-Authorization",
  ])
    assert.throws(() =>
      logDrainCredentialSchema.parse({
        ...base,
        auth: "headers",
        headers: [{ name, value: "forbidden" }],
      }),
    );
  assert.equal(
    logDrainCredentialSchema.parse({
      ...base,
      auth: "basic",
      username: "collector",
      apiKey: "password with spaces",
    }).apiKey,
    "password with spaces",
  );
  assert.deepEqual(logDrainsSchema.parse(logDrainProviders), logDrainProviders);
});

void test("secret metadata, updates, rotation and auth changes preserve only explicitly retained credentials", () => {
  const base = {
    provider: "otlp",
    endpoint: "https://collector.example.com/v1/logs",
    auth: "headers",
    headers: [
      { name: "Authorization", value: "Bearer secret-token" },
      { name: "X-Team", value: "secret-team" },
    ],
  };
  const existing = logDrainCredentialSchema.parse(base);
  assert(
    !JSON.stringify(logDrainPublicConfiguration(existing)).includes("secret"),
  );
  const kept = mergeLogDrainCredential(
    { ...base, headers: [{ name: "authorization", value: "" }] },
    existing,
  );
  assert.equal(logDrainSecret(kept, "Authorization"), "Bearer secret-token");
  assert.equal(logDrainSecret(kept, "X-Team"), undefined);
  const rotated = mergeLogDrainCredential(
    { ...base, headers: [{ name: "Authorization", value: "Bearer rotated" }] },
    kept,
  );
  assert.equal(logDrainSecret(rotated, "authorization"), "Bearer rotated");
  assert.throws(() =>
    mergeLogDrainCredential(
      { ...base, headers: [{ name: "New-Header", value: "" }] },
      existing,
    ),
  );
  const basic = logDrainCredentialSchema.parse({
    provider: "loki",
    endpoint: "https://logs.example.com/loki/api/v1/push",
    auth: "basic",
    username: "user",
    apiKey: "stored-password",
  });
  assert(
    !JSON.stringify(logDrainPublicConfiguration(basic)).includes(
      "stored-password",
    ),
  );
  assert.throws(() =>
    mergeLogDrainCredential(
      { ...basic, auth: "bearer", username: "", apiKey: "" },
      basic,
    ),
  );
  assert.equal(
    mergeLogDrainCredential(
      { ...basic, auth: "none", username: "", apiKey: "" },
      basic,
    ).apiKey,
    "",
  );
  assert.equal(
    mergeLogDrainCredential({ ...basic, apiKey: "" }, basic).apiKey,
    "stored-password",
  );
});

void test("removed log destinations are rejected by manifests and credentials", () => {
  for (const provider of ["signoz", "splunk", "honeycomb", "mezmo"]) {
    assert.throws(() => logDrainsSchema.parse([provider]));
    assert.throws(() =>
      logDrainCredentialSchema.parse({ provider, apiKey: "test-api-key" }),
    );
  }
});
