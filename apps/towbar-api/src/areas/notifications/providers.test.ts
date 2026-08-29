import assert from "node:assert/strict";
import test from "node:test";

import {
  isPrivateOrReservedAddress,
  validateSlackWebhookUrl,
} from "./providers.js";

void test("accepts only Slack incoming webhook endpoints", () => {
  assert.equal(
    validateSlackWebhookUrl("https://hooks.slack.com/services/T/B/token").host,
    "hooks.slack.com",
  );
  assert.throws(
    () => validateSlackWebhookUrl("https://127.0.0.1/services/T/B/token"),
    /Slack incoming webhook/u,
  );
  assert.throws(
    () => validateSlackWebhookUrl("https://hooks.slack.com.example/services/x"),
    /Slack incoming webhook/u,
  );
});

void test("blocks private and reserved SMTP targets", () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "192.0.2.1",
    "198.51.100.1",
    "203.0.113.1",
    "::1",
    "fd00::1",
    "fe80::1",
    "2001:db8::1",
  ]) {
    assert.equal(isPrivateOrReservedAddress(address), true, address);
  }
  assert.equal(isPrivateOrReservedAddress("8.8.8.8"), false);
  assert.equal(isPrivateOrReservedAddress("2606:4700:4700::1111"), false);
});
