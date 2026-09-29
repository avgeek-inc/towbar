import assert from "node:assert/strict";
import test from "node:test";

import { cloudflareDnsCredential } from "./cloudflare-readiness.js";
import { normalizeDeploymentManifest } from "@workspace/towbar-core";

void test("direct TLS does not require Cloudflare runtime credentials", () => {
  assert.equal(
    cloudflareDnsCredential({ tls: { mode: "direct" } }, null),
    null,
  );
});

void test("Cloudflare DNS deployments fail before admission without runtime credentials", () => {
  assert.throws(
    () => cloudflareDnsCredential({ tls: { mode: "cloudflare-dns" } }, null),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes("Configure Cloudflare in the Towbar runtime"),
  );
});

void test("Cloudflare DNS deployments use the runtime token", () => {
  assert.deepEqual(
    cloudflareDnsCredential(
      { tls: { mode: "cloudflare-dns" } },
      {
        configuration: {
          accountId: "account-id",
          cloudflaredImage:
            "cloudflare/cloudflared@sha256:b269e8abd07a5bf6f3f4be65d5050b2174eca89c56a0241a8ff32a16aec454e4",
        },
        credentials: { apiToken: "runtime-token" },
        provider: "cloudflare",
      },
    ),
    { apiToken: "runtime-token" },
  );
});

void test("Compose resolves the runtime token only for DNS routes, including mixed modes", () => {
  const app = normalizeDeploymentManifest({
    version: 2,
    compose: [
      {
        id: "stack",
        name: "Stack",
        server: "192.0.2.10",
        file: "compose.yml",
        services: {
          web: {
            port: 3000,
            domains: ["web.example.com"],
            tls: { mode: "direct" },
          },
          api: {
            port: 8080,
            domains: ["api.example.com"],
            ingress: { type: "proxy" },
            tls: { mode: "cloudflare-dns" },
          },
        },
      },
    ],
  }).compose![0]!;
  assert.throws(
    () => cloudflareDnsCredential(app, null),
    /Configure Cloudflare/,
  );
  assert.deepEqual(
    cloudflareDnsCredential(app, {
      provider: "cloudflare",
      credentials: { apiToken: "runtime-token" },
      configuration: {
        accountId: "account-id",
        cloudflaredImage:
          "cloudflare/cloudflared@sha256:b269e8abd07a5bf6f3f4be65d5050b2174eca89c56a0241a8ff32a16aec454e4",
      },
    }),
    { apiToken: "runtime-token" },
  );
  assert.equal(
    cloudflareDnsCredential({ services: { web: app.services.web! } }, null),
    null,
  );
});
