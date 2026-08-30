import assert from "node:assert/strict";
import test from "node:test";

import { slackNotificationConfigSchema } from "@workspace/towbar-core";

import { isPrivateOrReservedAddress } from "./providers.js";

void test("accepts Slack channel IDs without storing credentials", () => {
  assert.deepEqual(
    slackNotificationConfigSchema.parse({ channelId: "C12345678" }),
    {
      channelId: "C12345678",
    },
  );
  assert.throws(
    () => slackNotificationConfigSchema.parse({ channelId: "#general" }),
    /valid Slack channel ID/u,
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
