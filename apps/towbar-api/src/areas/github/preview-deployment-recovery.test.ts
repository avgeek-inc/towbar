import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";

void test("reuses a preview deployment after GitHub accepted creation but its response was lost", async (t) => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const configuration = {
    appId: "1001",
    appSlug: "towbar-test",
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    webhookSecret: "test",
  };
  let created: Record<string, unknown> | undefined;
  let creates = 0;
  t.mock.method(globalThis, "fetch", (value: string, init: RequestInit) => {
    if (value.endsWith("/access_tokens"))
      return Response.json({
        token: "test-token",
        expires_at: "2099-01-01T00:00:00Z",
      });
    if (init.method === "GET") return Response.json(created ? [created] : []);
    creates += 1;
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    created = { ...body, id: 42, sha: body.ref };
    throw new DOMException("response lost", "TimeoutError");
  });
  const { createGitHubPreviewDeployment } = await import("./client.js");
  const input = {
    appName: "App",
    commitSha: "a".repeat(40),
    environmentUrl: "https://pr-7.example.test",
    installationId: "123",
    pullRequestNumber: 7,
    repositoryOwner: "fixture",
    repositoryName: "repo",
    towbarDeploymentId: "11111111-1111-4111-8111-111111111111",
  };
  await assert.rejects(
    createGitHubPreviewDeployment(input, configuration),
    /timed out/u,
  );
  assert.equal(await createGitHubPreviewDeployment(input, configuration), "42");
  assert.equal(creates, 1);
});
