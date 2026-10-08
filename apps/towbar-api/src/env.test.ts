import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

function startWithOrigins(appOrigin: string, apiOrigin?: string) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "production",
    DATABASE_TOWBAR_URL: "postgres://config@localhost/config_test",
    TOWBAR_CREDENTIALS_KEY: Buffer.alloc(32, 1).toString("base64"),
    TOWBAR_INTERNAL_HMAC_SECRET: "configuration-only-test-secret-32-bytes",
    TOWBAR_APP_BASE_URL: appOrigin,
  };
  if (apiOrigin) env.TOWBAR_API_BASE_URL = apiOrigin;
  else delete env.TOWBAR_API_BASE_URL;
  execFileSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      'import { getEnv } from "./src/env.ts"; getEnv();',
    ],
    { cwd: new URL("..", import.meta.url), env, stdio: "pipe" },
  );
}

void test("public dashboard startup fails closed instead of issuing loopback HTTP cookies", () => {
  assert.throws(
    () => startWithOrigins("https://towbar.avgeek.ltd"),
    /An HTTPS dashboard requires an HTTPS API origin/,
  );
  assert.throws(
    () =>
      startWithOrigins("https://towbar.avgeek.ltd", "http://localhost:4020"),
    /An HTTPS dashboard requires an HTTPS API origin/,
  );
  startWithOrigins(
    "https://towbar.avgeek.ltd",
    "https://towbar-api.avgeek.ltd",
  );
  startWithOrigins("http://localhost:4021", "http://localhost:4020");
});
