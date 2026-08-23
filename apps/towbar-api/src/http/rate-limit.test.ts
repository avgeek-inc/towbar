import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  type AuthRateLimitCounter,
  checkPasswordLoginRateLimit,
  resolveClientAddress,
} from "./rate-limit.js";

void describe("authentication rate limiting", () => {
  void it("ignores spoofed forwarding headers when no proxy is trusted", () => {
    assert.equal(
      resolveClientAddress({
        forwardedFor: "198.51.100.200",
        peerAddress: "203.0.113.10",
        trustedProxyHops: 0,
      }),
      "203.0.113.10",
    );
  });

  void it("uses the rightmost untrusted address for an explicit proxy hop", () => {
    assert.equal(
      resolveClientAddress({
        forwardedFor: "198.51.100.200, 203.0.113.40",
        peerAddress: "10.0.0.5",
        trustedProxyHops: 1,
      }),
      "203.0.113.40",
    );
  });

  void it("blocks one account even when attempts rotate client addresses", async () => {
    const counter = createPersistentCounter();
    const now = new Date("2026-08-23T00:00:00.000Z");
    for (let attempt = 0; attempt < 12; attempt += 1) {
      assert.equal(
        await checkPasswordLoginRateLimit({
          clientAddress: `198.51.100.${attempt + 1}`,
          counter,
          email: "Owner@Example.com",
          now,
        }),
        null,
      );
    }

    const retryAfter = await checkPasswordLoginRateLimit({
      clientAddress: "203.0.113.100",
      counter,
      email: "owner@example.com",
      now,
    });
    assert.equal(retryAfter, 15 * 60);

    assert.equal(
      await checkPasswordLoginRateLimit({
        clientAddress: "203.0.113.101",
        counter,
        email: "different@example.com",
        now,
      }),
      null,
    );
  });
});

function createPersistentCounter(): AuthRateLimitCounter {
  const buckets = new Map<string, { attempts: number; expiresAt: Date }>();
  return (subject, now, windowMs) => {
    const current = buckets.get(subject);
    const bucket =
      !current || current.expiresAt <= now
        ? { attempts: 1, expiresAt: new Date(now.getTime() + windowMs) }
        : { ...current, attempts: current.attempts + 1 };
    buckets.set(subject, bucket);
    return Promise.resolve(bucket);
  };
}
