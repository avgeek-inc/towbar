import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

process.env.DATABASE_TOWBAR_URL =
  "postgres://towbar:test@127.0.0.1:5432/towbar";
process.env.TOWBAR_CREDENTIALS_KEY = randomBytes(32).toString("base64");
process.env.TOWBAR_INTERNAL_HMAC_SECRET = randomBytes(32).toString("hex");
process.env.TOWBAR_API_BASE_URL = "http://localhost:4020";
process.env.TOWBAR_APP_BASE_URL = "http://localhost:4021";

const { createApp } = await import("../app.js");
const { hasHttpsExternalAccess } = await import("./external-access.js");

void test("external REST and MCP require an HTTPS Towbar origin", async () => {
  assert.equal(hasHttpsExternalAccess("http://localhost:4020"), false);
  assert.equal(hasHttpsExternalAccess("https://towbar.example.com"), true);

  const app = createApp();
  for (const path of ["/v1/api", "/v1/api/apps", "/v1/mcp"]) {
    const response = await app.request(path);
    assert.equal(response.status, 404, path);
  }
});
