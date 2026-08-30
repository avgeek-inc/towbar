import assert from "node:assert/strict";
import test from "node:test";

import { HttpError } from "../../http/errors.js";
import { classifyGitHubResponseFailure, githubRequest } from "./request.js";

void test("retries transport timeouts before returning GitHub data", async () => {
  let attempts = 0;
  const delays: number[] = [];
  const value = await githubRequest(
    "/meta",
    { token: "test-token" },
    {
      fetch: () => {
        attempts += 1;
        if (attempts < 3) {
          throw new DOMException("timed out", "TimeoutError");
        }
        return Promise.resolve(Response.json({ ok: true }));
      },
      sleep: (delay) => {
        delays.push(delay);
        return Promise.resolve();
      },
    },
  );

  assert.deepEqual(value, { ok: true });
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [250, 500]);
});

void test("reports exhausted timeouts as retryable connectivity failures", async () => {
  await assert.rejects(
    githubRequest(
      "/meta",
      { token: "test-token" },
      {
        fetch: () => {
          throw new DOMException("timed out", "TimeoutError");
        },
        sleep: () => Promise.resolve(),
      },
    ),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 503);
      assert.equal(error.code, "SERVICE_UNAVAILABLE");
      assert.match(error.message, /timed out after 3 attempts/u);
      assert.doesNotMatch(error.message, /rejected/u);
      return true;
    },
  );
});

void test("retries temporary GitHub responses", async () => {
  let attempts = 0;
  const value = await githubRequest(
    "/meta",
    { token: "test-token" },
    {
      fetch: () => {
        attempts += 1;
        return Promise.resolve(
          attempts === 1
            ? new Response(null, { status: 503 })
            : Response.json({ ok: true }),
        );
      },
      sleep: () => Promise.resolve(),
    },
  );

  assert.deepEqual(value, { ok: true });
  assert.equal(attempts, 2);
});

void test("does not replay a non-idempotent GitHub request", async () => {
  let attempts = 0;
  await assert.rejects(
    githubRequest(
      "/repos/example/comments",
      { body: { body: "hello" }, method: "POST", token: "test-token" },
      {
        fetch: () => {
          attempts += 1;
          throw new DOMException("timed out", "TimeoutError");
        },
        sleep: () => Promise.resolve(),
      },
    ),
    /timed out after 1 attempt/u,
  );
  assert.equal(attempts, 1);
});

void test("distinguishes rate limits from permission failures", () => {
  const rateLimit = classifyGitHubResponseFailure(
    new Response(null, {
      headers: {
        "x-github-request-id": "request-1",
        "x-ratelimit-remaining": "0",
      },
      status: 403,
    }),
  );
  const permission = classifyGitHubResponseFailure(
    new Response(null, { status: 403 }),
  );
  const authentication = classifyGitHubResponseFailure(
    new Response(null, { status: 401 }),
  );

  assert.equal(rateLimit.code, "GITHUB_RATE_LIMITED");
  assert.equal(rateLimit.retryable, true);
  assert.match(rateLimit.publicMessage, /rate limit exceeded/u);
  assert.equal(permission.code, "GITHUB_REQUEST_FAILED");
  assert.equal(permission.retryable, false);
  assert.match(permission.publicMessage, /denied this request/u);
  assert.equal(authentication.status, 403);
  assert.equal(authentication.retryable, false);
});
