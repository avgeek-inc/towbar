import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import { verifyWebhookSignature } from "./webhooks.js";

void test("GitHub webhooks skip signature verification without a configured secret", () => {
  assert.doesNotThrow(() =>
    verifyWebhookSignature('{"action":"created"}', undefined, undefined),
  );
});

void test("GitHub webhooks require a valid signature when a secret is configured", () => {
  const body = '{"action":"created"}';
  const secret = "a-secure-webhook-secret";
  const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

  assert.doesNotThrow(() => verifyWebhookSignature(body, signature, secret));
  assert.throws(
    () => verifyWebhookSignature(body, undefined, secret),
    /Required GitHub webhook signature is missing/u,
  );
  assert.throws(
    () => verifyWebhookSignature(body, "sha256=invalid", secret),
    /GitHub webhook signature is invalid/u,
  );
});
