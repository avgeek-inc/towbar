import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import { previewHostname } from "../../packages/towbar-core/dist/index.js";

const require = createRequire(
  new URL("../../apps/towbar-api/package.json", import.meta.url),
);
const { eq } = require("drizzle-orm");

export async function runPreviewLifecycle({
  database,
  temporal,
  target,
  originalFetch,
  setFetch,
}) {
  const { db, schema, instances, sourceId, workspaceId, userId, mutateSecret } =
    database.previewContext;
  const staging = instances.get("staging");
  const [persistent] = await db
    .select()
    .from(schema.apps)
    .where(eq(schema.apps.id, staging.id));
  const config = {
    ...persistent.config,
    health: { type: "http", path: "/", timeoutSeconds: 10 },
    preview: { enabled: true, domain: "127.0.0.1.nip.io", ttlHours: 24 },
  };
  await db
    .update(schema.apps)
    .set({ config })
    .where(eq(schema.apps.id, staging.id));
  await db
    .update(schema.sourceEnvironments)
    .set({ previewsEnabled: true })
    .where(eq(schema.sourceEnvironments.id, staging.environment.id));
  for (const [stage, set] of [
    ["build", { BUILD_MARKER: "test-build-value" }],
    ["deployment", { ENV_MARKER: "preview" }],
  ]) {
    await mutateSecret(
      {
        type: "app",
        id: staging.id,
        workspaceId,
        environment: "preview:staging",
        stage,
      },
      { expectedRevision: null, set, delete: [] },
      userId,
    );
  }
  const hostname = previewHostname({
    appId: staging.id,
    domain: config.preview.domain,
    pullRequestNumber: 42,
    sourceId,
  });
  const root =
    "version: 2\nenvironments:\n  production: {}\n  staging:\n    previews:\n      enabled: true\n";
  const app = `id: website
name: Website
dockerfile: Dockerfile
container:
  port: 8080
health:
  path: /
  timeoutSeconds: 10
secrets:
  build: [BUILD_MARKER]
  runtime: [ENV_MARKER]
domains:
  primary: staging.127.0.0.1.nip.io
tls:
  mode: direct
preview:
  enabled: true
  domain: ignored.example.com
environments:
  staging:
    server: test
`;
  let revision = "a",
    closed = false,
    nextId = 100;
  const reports = [],
    unexpected = [];
  const entries = [
    ["towbar.yml", "1".repeat(40), root],
    [".towbar/apps/website.app.yml", "2".repeat(40), app],
  ];
  setFetch(async (input, init) => {
    const url = new URL(String(input));
    if (url.origin === `https://${hostname}`) return originalFetch(input, init);
    const route = url.pathname;
    if (
      url.origin === "https://api.github.com" &&
      route.startsWith("/repos/test/test/") &&
      !route.includes("/tarball/")
    ) {
      if (route === "/repos/test/test/pulls/42")
        return Response.json({
          number: 42,
          state: closed ? "closed" : "open",
          merged: closed,
          draft: false,
          changed_files: 1,
          base: { ref: "develop", repo: { full_name: "test/test" } },
          head: {
            ref: "feature/test",
            sha: revision.repeat(40),
            repo: { full_name: "test/test" },
          },
        });
      if (route === "/repos/test/test/pulls/42/files")
        return Response.json([{ filename: "app.py" }]);
      if (route === `/repos/test/test/git/commits/${revision.repeat(40)}`)
        return Response.json({ tree: { sha: "3".repeat(40) } });
      if (route === `/repos/test/test/git/trees/${"3".repeat(40)}`)
        return Response.json({
          truncated: false,
          tree: entries.map(([path, sha]) => ({
            path,
            sha,
            type: "blob",
            mode: "100644",
          })),
        });
      const blob = entries.find(
        ([, sha]) => route === `/repos/test/test/git/blobs/${sha}`,
      );
      if (blob)
        return Response.json({
          content: Buffer.from(blob[2]).toString("base64"),
          encoding: "base64",
          size: Buffer.byteLength(blob[2]),
        });
      if (
        route === "/repos/test/test/deployments" ||
        /^\/repos\/test\/test\/deployments\/\d+\/statuses$/.test(route)
      ) {
        reports.push(JSON.parse(init.body));
        return Response.json({ id: nextId++ });
      }
      if (route === "/repos/test/test/issues/42/comments")
        return Response.json(
          init?.method === "POST"
            ? { id: nextId++, body: JSON.parse(init.body).body }
            : [],
        );
      unexpected.push(route);
      throw new Error(`Unexpected PR GitHub request: ${route}`);
    }
    throw new Error(`Unexpected PR request: ${url}`);
  });
  try {
    const { processPreviewPullRequestEvent } =
      await import("../../apps/towbar-api/dist/areas/previews/service.js");
    const event = { sourceId, pullRequestNumber: 42 };
    let preview;
    for (revision of ["a", "b"]) {
      const result = await processPreviewPullRequestEvent(event);
      assert.equal(result.retry, false);
      assert.equal(result.deploymentIds.length, 1);
      await temporal.execute(result.deploymentIds[0]);
      [preview] = await db
        .select()
        .from(schema.previewEnvironments)
        .where(eq(schema.previewEnvironments.appId, staging.id));
      assert.equal(preview.status, "healthy");
      assert.equal(preview.hostname, hostname);
      assert.equal(
        await (await originalFetch(`https://${hostname}`)).text(),
        `preview:${revision}`,
      );
      const replay = await processPreviewPullRequestEvent(event);
      assert.deepEqual(replay.deploymentIds, result.deploymentIds);
      assert.equal(
        await (
          await originalFetch("https://production.127.0.0.1.nip.io")
        ).text(),
        "production:a",
      );
      assert.equal(
        await (await originalFetch("https://staging.127.0.0.1.nip.io")).text(),
        "staging:b",
      );
    }
    closed = true;
    const cleanup = await processPreviewPullRequestEvent(event);
    assert.deepEqual(cleanup.cleanupIds, [preview.id]);
    const deadline = Date.now() + 60_000;
    for (;;) {
      const [row] = await db
        .select()
        .from(schema.previewEnvironments)
        .where(eq(schema.previewEnvironments.id, preview.id));
      if (row.status === "deleted") break;
      assert.notEqual(row.status, "cleanup_failed", row.errorMessage);
      assert(Date.now() < deadline, "Preview cleanup must complete");
      await delay(200);
    }
    assert.equal(
      (await processPreviewPullRequestEvent(event)).cleanupIds.length,
      0,
    );
    assert.equal(
      await (await originalFetch("https://production.127.0.0.1.nip.io")).text(),
      "production:a",
    );
    assert.equal(
      await (await originalFetch("https://staging.127.0.0.1.nip.io")).text(),
      "staging:b",
    );
    assert.equal(
      target.ssh(
        `docker ps -aq --filter label=towbar.app=${preview.runtimeId}`,
      ),
      "",
    );
    assert.equal(
      target.ssh(
        `docker image ls -q --filter label=towbar.app=${preview.runtimeId}`,
      ),
      "",
    );
    target.ssh(`sudo test ! -e /etc/caddy/towbar/${preview.runtimeId}.caddy`);
    const [after] = await db
      .select()
      .from(schema.apps)
      .where(eq(schema.apps.id, staging.id));
    assert.deepEqual(after.config, config);
    assert.deepEqual(after.requiredSecrets, persistent.requiredSecrets);
    assert.deepEqual(unexpected, []);
    assert(
      reports.some((item) => item.state === "success"),
      "Preview success must be reported to GitHub",
    );
    await temporal.verify([
      "COMPLETED",
      "COMPLETED",
      "COMPLETED",
      "FAILED",
      "COMPLETED",
      "COMPLETED",
    ]);
    console.log(
      "PR reconciliation deployed two immutable revisions over HTTPS, replayed admission, and cleaned up on close while persistent environments stayed available.",
    );
  } finally {
    setFetch(undefined);
  }
}
