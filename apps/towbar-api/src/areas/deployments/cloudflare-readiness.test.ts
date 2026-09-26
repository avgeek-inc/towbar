import assert from "node:assert/strict";
import test from "node:test";

import { cloudflareDnsCredential } from "./cloudflare-readiness.js";

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
