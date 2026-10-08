import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { serve } from "@hono/node-server";
import { Hono } from "hono";

import {
  type AuthRateLimitCounter,
  checkPasswordLoginRateLimit,
  getClientAddress,
} from "./rate-limit.js";

void describe("authentication rate limiting", () => {
  void it("uses the connection peer despite supplied forwarding headers", async () => {
    const app = new Hono();
    app.get("/client-address", (context) =>
      context.text(getClientAddress(context)),
    );
    const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 });
    try {
      await new Promise<void>((resolve) => server.once("listening", resolve));
      const address = server.address();
      assert(address && typeof address !== "string");
      const url = `http://127.0.0.1:${address.port}/client-address`;
      for (const headers of [
        {},
        { "x-forwarded-for": "198.51.100.200, 203.0.113.40" },
        {
          forwarded: "for=198.51.100.200",
          "x-real-ip": "203.0.113.40",
          "cf-connecting-ip": "192.0.2.44",
        },
      ]) {
        const response = await fetch(url, { headers });
        assert.equal(response.status, 200);
        assert.equal(await response.text(), "127.0.0.1");
      }
    } finally {
      server.close();
    }
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
