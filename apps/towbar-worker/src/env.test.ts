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

void test("requires the vulnerability scanner image to pin a tag and digest", () => {
  assert.match(
    parseEnv(requiredEnv).TOWBAR_TRIVY_IMAGE,
    /^aquasec\/trivy:0\.74\.0@sha256:[a-f0-9]{64}$/u,
  );
  assert.throws(() =>
    parseEnv({ ...requiredEnv, TOWBAR_TRIVY_IMAGE: "aquasec/trivy:latest" }),
  );
});
