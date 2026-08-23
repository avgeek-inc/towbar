import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { requestSignatureHeaders } from "@workspace/towbar-core/request-signing";

import { TowbarApiError, signedApiRequest } from "./towbar-api.js";

process.env.TOWBAR_API_BASE_URL = "https://api.towbar.test";
process.env.TOWBAR_INTERNAL_HMAC_SECRET = "t".repeat(32);

void describe("signed Towbar API requests", () => {
  void it("retries transient responses with backoff and fresh signatures", async () => {
    const delays: number[] = [];
    const nonces: string[] = [];
    let calls = 0;
    const fetcher: typeof fetch = (_target, init) => {
      calls += 1;
      nonces.push(
        new Headers(init?.headers).get(requestSignatureHeaders.nonce)!,
      );
      return Promise.resolve(
        calls < 3
          ? Response.json(null, { status: 521 })
          : Response.json({ accepted: true }),
      );
    };

    const result = await signedApiRequest<{ accepted: boolean }>(
      "POST",
      "/v1/internal/deployments/example/events",
      { state: "building" },
      {
        fetcher,
        random: () => 0,
        sleep: (delayMs) => {
          delays.push(delayMs);
          return Promise.resolve();
        },
      },
    );

    assert.deepEqual(result, { accepted: true });
    assert.deepEqual(delays, [500, 1_000]);
    assert.equal(new Set(nonces).size, 3);
  });

  void it("does not retry non-transient client responses", async () => {
    let calls = 0;
    const fetcher: typeof fetch = () => {
      calls += 1;
      return Promise.resolve(Response.json(null, { status: 401 }));
    };

    await assert.rejects(
      signedApiRequest("GET", "/v1/internal/example", undefined, {
        fetcher,
        sleep: () => Promise.resolve(),
      }),
      (error) => error instanceof TowbarApiError && error.status === 401,
    );
    assert.equal(calls, 1);
  });

  void it("retries network failures up to the configured bound", async () => {
    let calls = 0;
    const failure = new TypeError("fetch failed");
    const fetcher: typeof fetch = () => {
      calls += 1;
      return Promise.reject(failure);
    };

    await assert.rejects(
      signedApiRequest("GET", "/v1/internal/example", undefined, {
        fetcher,
        maximumAttempts: 3,
        random: () => 0,
        sleep: () => Promise.resolve(),
      }),
      (error) => error === failure,
    );
    assert.equal(calls, 3);
  });
});
