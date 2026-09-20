import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";

import { parseRuntimeIntegrations } from "./runtime-integrations.js";

void test("returns only integrations explicitly enabled by the environment", () => {
  const runtime = parseRuntimeIntegrations({
    TOWBAR_AWS_ACCESS_KEY_ID: "AKIAEXAMPLE",
    TOWBAR_AWS_ENABLED: "true",
    TOWBAR_AWS_REGION: "us-east-1",
    TOWBAR_AWS_SECRET_ACCESS_KEY: "secret",
  });

  assert.deepEqual(runtime.capabilities, [
    { category: "backup", provider: "aws" },
  ]);
  assert.equal(runtime.providers.aws?.provider, "aws");
  assert.equal(runtime.providers.gcs, undefined);
});

void test("fails startup when an enabled integration is incomplete", () => {
  assert.throws(
    () => parseRuntimeIntegrations({ TOWBAR_AZURE_ENABLED: "true" }),
    /TOWBAR_AZURE_STORAGE_ACCOUNT is required/u,
  );
});

void test("decodes and validates the GitHub App private key", () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  const runtime = parseRuntimeIntegrations({
    TOWBAR_GITHUB_APP_ID: "12345",
    TOWBAR_GITHUB_APP_SLUG: "towbar-test",
    TOWBAR_GITHUB_ENABLED: "true",
    TOWBAR_GITHUB_PRIVATE_KEY_BASE64: Buffer.from(pem).toString("base64"),
    TOWBAR_GITHUB_WEBHOOK_SECRET: "a-secure-webhook-secret",
  });

  assert.equal(runtime.github?.privateKey, pem);
  assert.equal(runtime.providers.github?.provider, "github");
});
