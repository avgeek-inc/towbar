import assert from "node:assert/strict";
import test from "node:test";

import { parseEnv } from "./env.js";

const requiredEnv = {
  TOWBAR_INTERNAL_HMAC_SECRET: "x".repeat(32),
};

void test("worker activity concurrency defaults to four", () => {
  assert.equal(
    parseEnv(requiredEnv).TOWBAR_WORKER_MAX_CONCURRENT_ACTIVITIES,
    4,
  );
});

void test("worker activity concurrency accepts a bounded override", () => {
  assert.equal(
    parseEnv({
      ...requiredEnv,
      TOWBAR_WORKER_MAX_CONCURRENT_ACTIVITIES: "16",
    }).TOWBAR_WORKER_MAX_CONCURRENT_ACTIVITIES,
    16,
  );
  assert.throws(() =>
    parseEnv({
      ...requiredEnv,
      TOWBAR_WORKER_MAX_CONCURRENT_ACTIVITIES: "65",
    }),
  );
});
