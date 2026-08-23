import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

process.env.DATABASE_TOWBAR_URL =
  "postgres://towbar:test@127.0.0.1:5432/towbar";
process.env.DATABASE_TOWBAR_MIGRATOR_URL = process.env.DATABASE_TOWBAR_URL;
process.env.TOWBAR_CREDENTIALS_KEY =
  "test-credentials-key-that-is-at-least-forty-characters";
process.env.TOWBAR_INTERNAL_HMAC_SECRET =
  "test-hmac-secret-that-is-long-enough";
process.env.TOWBAR_APP_BASE_URL = "https://app.towbar.test";
process.env.TOWBAR_SSO_BASE_URL = "https://sso.towbar.test";

let app: Awaited<ReturnType<typeof loadApp>>;

async function loadApp() {
  const { createApp } = await import("./app.js");
  return createApp();
}

void before(async () => {
  app = await loadApp();
});

void describe("Towbar API boundaries", () => {
  void it("does not expose a public signup route", async () => {
    const response = await app.request("/v1/public/signup", { method: "POST" });
    assert.equal(response.status, 404);
    const body = (await response.json()) as { error: { code: string } };
    assert.equal(body.error.code, "NOT_FOUND");
  });

  void it("allows credentialed CORS only from configured first-party origins", async () => {
    const trusted = await app.request("/v1/core/session", {
      headers: {
        "access-control-request-method": "GET",
        origin: "https://app.towbar.test",
      },
      method: "OPTIONS",
    });
    assert.equal(
      trusted.headers.get("access-control-allow-origin"),
      "https://app.towbar.test",
    );
    assert.equal(
      trusted.headers.get("access-control-allow-credentials"),
      "true",
    );

    const untrusted = await app.request("/v1/core/session", {
      headers: {
        "access-control-request-method": "GET",
        origin: "https://attacker.test",
      },
      method: "OPTIONS",
    });
    assert.equal(untrusted.headers.get("access-control-allow-origin"), null);
  });

  void it("rejects unsigned worker requests before they reach a handler", async () => {
    const response = await app.request("/v1/internal/health");
    assert.equal(response.status, 401);
    const body = (await response.json()) as { error: { code: string } };
    assert.equal(body.error.code, "UNAUTHORIZED");
  });

  void it("rejects oversized GitHub webhooks before signature work", async () => {
    const response = await app.request("/v1/public/webhooks/github", {
      body: "x".repeat(2 * 1_024 * 1_024 + 1),
      method: "POST",
    });
    assert.equal(response.status, 413);
    const body = (await response.json()) as { error: { code: string } };
    assert.equal(body.error.code, "PAYLOAD_TOO_LARGE");
  });

  void it("rate limits repeated password login attempts", async () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const response = await app.request("/v1/public/auth/login-email", {
        body: "{}",
        headers: {
          "cf-connecting-ip": "198.51.100.42",
          "content-type": "application/json",
        },
        method: "POST",
      });
      assert.equal(response.status, 400);
    }

    const blocked = await app.request("/v1/public/auth/login-email", {
      body: "{}",
      headers: {
        "cf-connecting-ip": "198.51.100.42",
        "content-type": "application/json",
      },
      method: "POST",
    });
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get("retry-after")) > 0);
  });
});
