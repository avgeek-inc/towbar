import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";

import {
  getPublicIntegrationCapabilities,
  parseRuntimeIntegrations,
} from "./runtime-integrations.js";

void test("publishes only allowlisted integration details", () => {
  const capabilities = getPublicIntegrationCapabilities({
    TOWBAR_CLOUDFLARE_ENABLED: "true",
    TOWBAR_CLOUDFLARE_ACCOUNT_ID: "account-123",
    TOWBAR_CLOUDFLARE_ZONE_ID: "zone-456",
    TOWBAR_CLOUDFLARE_API_TOKEN: "private-cloudflare-token",
    TOWBAR_S3_ENABLED: "true",
    TOWBAR_S3_REGION: "us-east-1",
    TOWBAR_S3_BUCKET: "towbar-backups",
    TOWBAR_S3_ACCESS_KEY_ID: "private-access-key-id",
    TOWBAR_S3_SECRET_ACCESS_KEY: "private-secret-access-key",
    TOWBAR_INFISICAL_ENABLED: "true",
    TOWBAR_INFISICAL_BASE_URL:
      "https://name:private-pass@secrets.example.com/?token=private-query",
    TOWBAR_INFISICAL_CLIENT_ID: "private-client-id",
    TOWBAR_INFISICAL_CLIENT_SECRET: "private-client-secret",
  });

  assert.deepEqual(capabilities, [
    {
      category: "backup",
      provider: "s3",
      details: [
        { label: "Region", value: "us-east-1" },
        { label: "Bucket", value: "towbar-backups" },
      ],
    },
    {
      category: "external-secrets",
      provider: "infisical",
      details: [{ label: "Server", value: "https://secrets.example.com" }],
    },
    {
      category: "platform",
      provider: "cloudflare",
      details: [
        { label: "Account ID", value: "account-123" },
        { label: "Zone ID", value: "zone-456" },
      ],
    },
  ]);
  assert.doesNotMatch(JSON.stringify(capabilities), /private-/u);
});

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
    () => parseRuntimeIntegrations({ TOWBAR_GCS_ENABLED: "true" }),
    /TOWBAR_GCS_PROJECT_ID is required/u,
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
  assert.equal(runtime.github?.webhookSecret, "a-secure-webhook-secret");
  assert.equal(runtime.providers.github?.provider, "github");
});

void test("accepts a GitHub App without a webhook secret", () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const runtime = parseRuntimeIntegrations({
    TOWBAR_GITHUB_APP_ID: "12345",
    TOWBAR_GITHUB_APP_SLUG: "towbar-test",
    TOWBAR_GITHUB_ENABLED: "true",
    TOWBAR_GITHUB_PRIVATE_KEY_BASE64: Buffer.from(
      privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    ).toString("base64"),
  });

  assert.equal(runtime.github?.webhookSecret, undefined);
  assert.equal(runtime.providers.github?.provider, "github");
});
