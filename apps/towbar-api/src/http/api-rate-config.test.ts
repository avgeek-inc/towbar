import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

function parseRateConfig(max?: string, seconds?: string) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_TOWBAR_URL: "postgres://test:test@localhost/towbar_test",
    TOWBAR_CREDENTIALS_KEY: Buffer.alloc(32, 1).toString("base64"),
    TOWBAR_INTERNAL_HMAC_SECRET: "test-only-api-rate-configuration-secret",
  };
  delete env.TOWBAR_API_RATE_LIMIT_MAX;
  delete env.TOWBAR_API_RATE_LIMIT_WINDOW_SECONDS;
  if (max !== undefined) env.TOWBAR_API_RATE_LIMIT_MAX = max;
  if (seconds !== undefined) env.TOWBAR_API_RATE_LIMIT_WINDOW_SECONDS = seconds;
  // Each process exercises the real startup parser without its module cache.
  return spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      'import {getEnv} from "./src/env.ts"; const env=getEnv(); console.log(JSON.stringify([env.TOWBAR_API_RATE_LIMIT_MAX,env.TOWBAR_API_RATE_LIMIT_WINDOW_SECONDS]));',
    ],
    { env, encoding: "utf8" },
  );
}
void test("external rate limits have defaults and configurable positive bounds", () => {
  const defaults = parseRateConfig();
  assert.equal(defaults.status, 0, defaults.stderr);
  assert.deepEqual(JSON.parse(defaults.stdout), [60, 60]);
  const custom = parseRateConfig("120", "30");
  assert.equal(custom.status, 0, custom.stderr);
  assert.deepEqual(JSON.parse(custom.stdout), [120, 30]);
  for (const [max, seconds] of [
    ["0", "60"],
    ["60", "0"],
    ["-1", "60"],
    ["1.5", "60"],
    ["abc", "60"],
    ["60", "86401"],
  ]) {
    assert.notEqual(parseRateConfig(max, seconds).status, 0);
  }
});
