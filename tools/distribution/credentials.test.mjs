import assert from "node:assert/strict";
import test from "node:test";
import { publicationCredentials } from "./credentials.mjs";
import { identity } from "./release.mjs";
const commit = "a".repeat(40);
const env = {
  ACTIONS_ID_TOKEN_REQUEST_URL:
    "https://pipelines.actions.githubusercontent.com/token?api-version=1",
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: "fixture-request-token",
  CLOUDFLARE_ACCOUNT_ID: "fixture-account",
};
const valid = {
  schemaVersion: 1,
  prefix: identity.releasePrefix,
  bucket: identity.releaseBucket,
  commit,
  endpoint: "https://fixture-account.r2.cloudflarestorage.com",
  accessKeyId: "fixture-access",
  secretAccessKey: "fixture-secret",
  sessionToken: "fixture-session",
  expiresAt: new Date(Date.now() + 900_000).toISOString(),
};
test("publisher exchanges OIDC for a session bound to the release without parent credentials", async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url: String(url), options });
    return Response.json(
      calls.length === 1 ? { value: "fixture-oidc" } : valid,
    );
  };
  assert.deepEqual(
    await publicationCredentials(identity, commit, env, fetcher),
    valid,
  );
  assert.equal(
    new URL(calls[0].url).searchParams.get("audience"),
    new URL(identity.distributionUrl).origin,
  );
  assert.equal(
    calls[1].url,
    `${new URL(identity.distributionUrl).origin}/publishing/credentials`,
  );
  assert.equal(calls[1].options.headers.Authorization, "Bearer fixture-oidc");
});
test("publisher rejects missing identity, unavailable broker, and mismatched or expired sessions", async () => {
  await assert.rejects(
    publicationCredentials(identity, commit, {}),
    /requires/,
  );
  await assert.rejects(
    publicationCredentials(
      identity,
      commit,
      env,
      async () => new Response(null, { status: 403 }),
    ),
    /did not issue/,
  );
  for (const changed of [
    { schemaVersion: 99 },
    { prefix: "other" },
    { bucket: "other" },
    { commit: "b".repeat(40) },
    { endpoint: "https://example.com" },
    { sessionToken: "" },
    { expiresAt: "2020-01-01T00:00:00Z" },
    { expiresAt: "invalid" },
  ]) {
    let calls = 0;
    await assert.rejects(
      publicationCredentials(identity, commit, env, async () =>
        Response.json(
          ++calls === 1 ? { value: "fixture-oidc" } : { ...valid, ...changed },
        ),
      ),
      /do not match/,
    );
  }
});
