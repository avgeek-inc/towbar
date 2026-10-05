import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import {
  normalizeDeploymentManifest,
  normalizeServerConfiguration,
} from "@workspace/towbar-core";
import {
  apps,
  deployments,
  integrationInstallations,
  previewEnvironments,
  previewPullRequestReports,
  servers,
  sources,
  workspaces,
} from "@workspace/towbar-database/schema";
import {
  testDeploymentEnvironment,
  testInstanceLinks,
} from "../sources/instance-test-helper.js";

const url = process.env.TOWBAR_TEST_DATABASE_URL;
void test(
  "preview reports recover current state, partial failures, interrupted writes and concurrent delivery",
  { skip: !url },
  async (t) => {
    assert(url && new URL(url).pathname.endsWith("_test"));
    process.env.DATABASE_TOWBAR_URL = url;
    process.env.TOWBAR_CREDENTIALS_KEY = randomBytes(32).toString("base64");
    process.env.TOWBAR_INTERNAL_HMAC_SECRET = randomBytes(32).toString("hex");
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    process.env.TOWBAR_GITHUB_ENABLED = "true";
    process.env.TOWBAR_GITHUB_APP_ID = "1001";
    process.env.TOWBAR_GITHUB_APP_SLUG = "reporting-test";
    process.env.TOWBAR_GITHUB_PRIVATE_KEY_BASE64 = Buffer.from(
      privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    ).toString("base64");
    const remoteDeployments: Array<{
      id: number;
      sha: string;
      environment: string;
      description: string;
      payload: unknown;
    }> = [];
    const comments: Array<{
      id: number;
      body: string;
      performed_via_github_app: { id: number };
    }> = [];
    const statuses: Array<{ id: string; state: string }> = [];
    let statusFailure = true;
    let commentFailure = true;
    let deploymentCreates = 0;
    let commentCreates = 0;
    t.mock.method(globalThis, "fetch", (value: string, init: RequestInit) => {
      const address = new URL(value);
      if (address.pathname.endsWith("/access_tokens"))
        return Response.json({
          token: "fixture-token",
          expires_at: "2099-01-01T00:00:00Z",
        });
      const body = init.body
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : {};
      if (address.pathname.endsWith("/deployments") && init.method === "GET")
        return Response.json(remoteDeployments);
      if (address.pathname.endsWith("/deployments") && init.method === "POST") {
        deploymentCreates += 1;
        const deployment = {
          id: deploymentCreates,
          sha: String(body.ref),
          environment: String(body.environment),
          description: String(body.description),
          payload: body.payload,
        };
        remoteDeployments.push(deployment);
        return Response.json({ id: deployment.id });
      }
      if (address.pathname.endsWith("/statuses")) {
        const id = address.pathname.split("/").at(-2)!;
        if (id === "1" && statusFailure) {
          statusFailure = false;
          return Response.json({}, { status: 503 });
        }
        statuses.push({ id, state: String(body.state) });
        return Response.json({ id: statuses.length });
      }
      if (address.pathname.endsWith("/comments") && init.method === "GET")
        return Response.json(comments);
      if (address.pathname.endsWith("/comments") && init.method === "POST") {
        commentCreates += 1;
        comments.push({
          id: commentCreates,
          body: String(body.body),
          performed_via_github_app: { id: 1001 },
        });
        if (commentFailure) {
          commentFailure = false;
          throw new DOMException("lost response", "TimeoutError");
        }
        return Response.json(comments.at(-1));
      }
      if (
        /\/issues\/comments\/\d+$/u.test(address.pathname) &&
        init.method === "PATCH"
      ) {
        comments[0]!.body = String(body.body);
        return Response.json(comments[0]);
      }
      throw new Error(
        `Unexpected fixture request: ${init.method} ${address.pathname}`,
      );
    });
    const { runTowbarMigrations } =
      await import("@workspace/towbar-database/migrate");
    await runTowbarMigrations({
      databaseUrl: url,
      logger: { info() {}, error() {} },
    });
    const { getTowbarDatabase, closeDatabase } =
      await import("../../infrastructure/database.js");
    const { publishPreviewDeploymentStatus } =
      await import("../deployments/preview-status.js");
    const { publishPreviewPullRequestComment } =
      await import("./pr-comment.js");
    const { recoverPreviewReporting } = await import("./reporting-retry.js");
    const { deliverPreviewReport } = await import("./reporting-delivery.js");
    const database = getTowbarDatabase();
    const workspaceId = randomUUID(),
      serverId = randomUUID(),
      sourceId = randomUUID();
    const report = { sourceId, pullRequestNumber: 7 };
    const server = normalizeServerConfiguration({
      ip: "192.0.2.210",
      ssh: { username: "deploy" },
    });
    const ids: string[] = [];
    const previewIds: string[] = [];
    try {
      await database.insert(workspaces).values({
        id: workspaceId,
        slug: workspaceId,
        name: "Preview recovery",
      });
      await database.insert(servers).values({
        id: serverId,
        workspaceId,
        canonicalIp: server.ip,
        config: server,
        configDigest: "fixture",
      });
      const [installation] = await database
        .insert(integrationInstallations)
        .values({
          workspaceId,
          provider: "github",
          externalId: randomUUID(),
          principalName: "fixture",
          principalType: "Organization",
        })
        .returning();
      await database.insert(sources).values({
        id: sourceId,
        workspaceId,
        integrationInstallationId: installation!.id,
        repositoryOwner: "fixture",
        repositoryName: "reporting",
      });
      await database.insert(previewPullRequestReports).values({
        ...report,
        workspaceId,
        branch: "feature",
        latestCommitSha: "a".repeat(40),
      });
      for (let index = 0; index < 2; index += 1) {
        const appId = randomUUID(),
          previewId = randomUUID(),
          id = randomUUID();
        ids.push(id);
        previewIds.push(previewId);
        const config = normalizeDeploymentManifest({
          version: 2,
          apps: [
            {
              id: `app-${index}`,
              name: `App ${index}`,
              server: server.ip,
              dockerfile: "Dockerfile",
              context: ".",
              container: { port: 3000 },
              health: { path: "/health" },
            },
          ],
        }).apps[0]!;
        await database.insert(apps).values({
          ...(await testInstanceLinks(sourceId, config.id)),
          id: appId,
          workspaceId,
          sourceId,
          serverId,
          manifestId: config.id,
          name: config.name,
          config,
          configDigest: "fixture",
          sourceRevision: "a".repeat(40),
        });
        await database.insert(previewEnvironments).values({
          id: previewId,
          ...report,
          workspaceId,
          appId,
          serverId,
          branch: "feature",
          gitRef: "refs/pull/7/head",
          hostname: `pr-${previewId}.example.test`,
          runtimeId: previewId,
          latestCommitSha: "a".repeat(40),
          latestDeploymentId: id,
          expiresAt: new Date(Date.now() + 86400_000),
        });
        await database.insert(deployments).values({
          id,
          workspaceId,
          sourceId,
          appId,
          serverId,
          previewEnvironmentId: previewId,
          environment: "preview",
          gitRef: "refs/pull/7/head",
          hostname: `pr-${previewId}.example.test`,
          targetEnvironment: await testDeploymentEnvironment(appId),
          requiredSecrets: {
            build: [],
            runtime: [],
            preDeploy: [],
            postDeploy: [],
          },
          state: "queued",
          commitSha: "a".repeat(40),
          manifestDigest: "fixture",
          idempotencyKey: id,
          temporalWorkflowId: id,
          appSnapshot: config,
          serverSnapshot: server,
        });
      }
      const readReport = async () =>
        (
          await database
            .select()
            .from(previewPullRequestReports)
            .where(eq(previewPullRequestReports.sourceId, sourceId))
        )[0]!;
      await assert.rejects(publishPreviewDeploymentStatus(ids[0]!, "queued"));
      assert.equal((await readReport()).deploymentDeliveryStatus, "failed");
      assert.equal(
        statuses.length,
        1,
        "another app succeeds without clearing the aggregate failure",
      );
      await assert.rejects(publishPreviewPullRequestComment(report));
      assert.equal((await readReport()).commentDeliveryStatus, "failed");
      await recoverPreviewReporting({ workspaceId });
      assert.equal(
        statuses.length,
        1,
        "backoff prevents early background retries",
      );
      for (const id of ids)
        await database
          .update(deployments)
          .set({ state: "succeeded" })
          .where(eq(deployments.id, id));
      for (const id of previewIds)
        await database
          .update(previewEnvironments)
          .set({ status: "healthy" })
          .where(eq(previewEnvironments.id, id));
      await database
        .update(previewPullRequestReports)
        .set({
          commentNextAttemptAt: new Date(0),
          deploymentNextAttemptAt: new Date(0),
        })
        .where(eq(previewPullRequestReports.sourceId, sourceId));
      const recovered = await recoverPreviewReporting({ workspaceId });
      assert.equal(recovered.failed, 0);
      assert.equal((await readReport()).commentDeliveryStatus, "published");
      assert.equal((await readReport()).deploymentDeliveryStatus, "published");
      assert.equal(deploymentCreates, 2);
      assert.equal(
        commentCreates,
        1,
        "a missed comment response must not create a duplicate",
      );
      assert.deepEqual(
        statuses.slice(-2).map((status) => status.state),
        ["success", "success"],
      );
      assert.match(comments[0]!.body, /Ready/u);
      const beforeUnchanged = statuses.length;
      await publishPreviewDeploymentStatus(ids[0]!, "queued");
      assert.equal(
        statuses.length,
        beforeUnchanged,
        "unchanged statuses are not resent and an obsolete caller state is not replayed",
      );
      let started!: () => void, finish!: () => void;
      const startedPromise = new Promise<void>((resolve) => {
        started = resolve;
      });
      const finishPromise = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const first = deliverPreviewReport(report, "comment", async () => {
        started();
        await finishPromise;
        return "first";
      });
      await startedPromise;
      let concurrentPublished = false;
      await deliverPreviewReport(report, "comment", () => {
        concurrentPublished = true;
        return Promise.resolve();
      });
      finish();
      await first;
      assert.equal(concurrentPublished, false);
      assert.equal(
        (await readReport()).commentDeliveryStatus,
        "pending",
        "a concurrent update stays queued after the older attempt completes",
      );
      await database
        .update(previewPullRequestReports)
        .set({
          commentNextAttemptAt: null,
          updatedAt: new Date(Date.now() - 11 * 60_000),
        })
        .where(eq(previewPullRequestReports.sourceId, sourceId));
      await recoverPreviewReporting({ workspaceId });
      assert.equal(
        (await readReport()).commentDeliveryStatus,
        "published",
        "an interrupted pending delivery is recovered",
      );
      const [previousDeployment] = await database
        .select()
        .from(deployments)
        .where(eq(deployments.id, ids[0]!));
      assert(previousDeployment);
      const supersededId = randomUUID();
      await database.insert(deployments).values({
        ...previousDeployment,
        id: supersededId,
        idempotencyKey: supersededId,
        temporalWorkflowId: supersededId,
        githubDeploymentId: "999",
        githubDeploymentStatus: "in_progress",
        state: "skipped",
      });
      await database
        .update(previewPullRequestReports)
        .set({
          deploymentDeliveryStatus: "failed",
          deploymentNextAttemptAt: null,
        })
        .where(eq(previewPullRequestReports.sourceId, sourceId));
      await recoverPreviewReporting({ workspaceId });
      assert.deepEqual(
        statuses.at(-1),
        { id: "999", state: "inactive" },
        "failed cleanup reporting for superseded deployments is also recovered",
      );
      const parallel = Array.from({ length: 12 }, (_, index) => ({
        sourceId,
        pullRequestNumber: index + 20,
      }));
      await database.insert(previewPullRequestReports).values(
        parallel.map((identity) => ({
          ...identity,
          workspaceId,
          branch: "parallel",
          latestCommitSha: "a".repeat(40),
        })),
      );
      await Promise.all(
        parallel.map((identity) =>
          deliverPreviewReport(identity, "comment", async () => {
            await database
              .select({ id: sources.id })
              .from(sources)
              .where(eq(sources.id, sourceId));
            return "published";
          }),
        ),
      );
      const parallelReports = await database
        .select()
        .from(previewPullRequestReports)
        .where(eq(previewPullRequestReports.sourceId, sourceId));
      assert.equal(
        parallelReports.filter(
          (item) =>
            item.pullRequestNumber >= 20 &&
            item.commentDeliveryStatus === "published",
        ).length,
        12,
        "parallel reports cannot exhaust the database pool while holding delivery locks",
      );
      for (const id of previewIds)
        await database
          .update(previewEnvironments)
          .set({ status: "deleted" })
          .where(eq(previewEnvironments.id, id));
      await database
        .update(previewPullRequestReports)
        .set({
          deploymentDeliveryStatus: "failed",
          deploymentNextAttemptAt: null,
        })
        .where(eq(previewPullRequestReports.sourceId, sourceId));
      await recoverPreviewReporting({ workspaceId });
      assert.deepEqual(
        statuses.slice(-2).map((status) => status.state),
        ["inactive", "inactive"],
      );
    } finally {
      await database
        .delete(deployments)
        .where(eq(deployments.workspaceId, workspaceId));
      await database
        .delete(previewEnvironments)
        .where(eq(previewEnvironments.workspaceId, workspaceId));
      await database.delete(apps).where(eq(apps.workspaceId, workspaceId));
      await database
        .delete(sources)
        .where(eq(sources.workspaceId, workspaceId));
      await database
        .delete(servers)
        .where(eq(servers.workspaceId, workspaceId));
      await database.delete(workspaces).where(eq(workspaces.id, workspaceId));
      await closeDatabase();
    }
  },
);
