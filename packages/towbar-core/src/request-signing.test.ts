import assert from "node:assert/strict";
import test from "node:test";

import {
  RequestSignatureError,
  canonicalizeRequestTarget,
  createRequestSignatureHeaders,
  verifyRequestSignature,
} from "./request-signing.js";

const secret = "towbar-test-request-signing-secret-that-is-long-enough";
const timestamp = "2026-08-19T08:00:00.000Z";
const nonce = "550e8400-e29b-41d4-a716-446655440000";

void test("binds internal signatures to method, target, timestamp, nonce, and body", () => {
  const headers = createRequestSignatureHeaders({
    body: '{"ok":true}',
    method: "POST",
    nonce,
    secret,
    target: "/v1/internal/deployments/1/events?z=2&a=1",
    timestamp,
  });
  assert.deepEqual(
    verifyRequestSignature({
      body: '{"ok":true}',
      headers,
      method: "POST",
      now: Date.parse(timestamp),
      secret,
      target: "/v1/internal/deployments/1/events?a=1&z=2",
    }),
    { nonce, timestamp },
  );
});

void test("rejects substitutions and expired signatures", () => {
  const headers = createRequestSignatureHeaders({
    body: "",
    method: "GET",
    nonce,
    secret,
    target: "/v1/internal/context",
    timestamp,
  });
  assert.throws(
    () =>
      verifyRequestSignature({
        body: "changed",
        headers,
        method: "GET",
        now: Date.parse(timestamp),
        secret,
        target: "/v1/internal/context",
      }),
    RequestSignatureError,
  );
  assert.throws(() =>
    verifyRequestSignature({
      body: "",
      headers,
      method: "GET",
      now: Date.parse(timestamp) + 5 * 60 * 1_000 + 1,
      secret,
      target: "/v1/internal/context",
    }),
  );
});

void test("canonicalizes repeated query parameters deterministically", () => {
  assert.equal(
    canonicalizeRequestTarget("/v1/internal/logs?tag=z&tag=a&q=hello%20world"),
    "/v1/internal/logs?q=hello+world&tag=a&tag=z",
  );
});
