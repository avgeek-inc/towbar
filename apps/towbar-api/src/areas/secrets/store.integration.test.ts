import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import {
  normalizeDeploymentManifest,
  normalizeServerConfiguration,
} from "@workspace/towbar-core";
import {
  apps,
  auditEvents,
  deployments,
  githubInstallations,
  managedSecrets,
  releases,
  servers,
  sources,
  users,
  workspaces,
} from "@workspace/towbar-database/schema";
import type { TowbarHonoEnvironment } from "../../http/types.js";

const url = process.env.TOWBAR_TEST_DATABASE_URL;
void test(
  "managed secrets: database, API boundaries, execution, and lifecycle",
  { skip: !url },
  async (t) => {
    assert(
      url && new URL(url).pathname.endsWith("_test"),
      "Use a dedicated database ending in _test",
    );
    process.env.DATABASE_TOWBAR_URL = url;
    process.env.TOWBAR_CREDENTIALS_KEY = randomBytes(32).toString("base64");
    process.env.TOWBAR_INTERNAL_HMAC_SECRET = randomBytes(32).toString("hex");
    process.env.TOWBAR_SLACK_BOT_TOKEN = "test-slack-token";
    process.env.TOWBAR_SMTP_HOST = "mail.example.com";
    process.env.TOWBAR_SMTP_FROM = "test@example.com";
    process.env.TOWBAR_SMTP_USERNAME = "test";
    process.env.TOWBAR_SMTP_PASSWORD = "test-smtp-password";
    const { runTowbarMigrations } =
      await import("@workspace/towbar-database/migrate");
    await runTowbarMigrations({
      databaseUrl: url,
      logger: { info() {}, error() {} },
    });
    const { getTowbarDatabase, closeDatabase } =
      await import("../../infrastructure/database.js");
    const {
      mutateSecret,
      readSecretValues,
      readSecretMetadata,
      resolveServerCredentials,
    } = await import("./store.js");
    const { listEnvironmentSecrets } = await import("../apps/secrets.js");
    const { environmentSecretRoutes } =
      await import("../../routes/v1/core/environment-secrets.js");
    const { serverCredentialRoutes } =
      await import("../../routes/v1/core/server-credentials.js");
    const {
      getNotificationProviderConfiguration,
      notificationProviderAvailability,
    } = await import("../notifications/configuration.js");
    const { applyDeployableAction } =
      await import("../sources/materialization.js");
    const { createServer, updateServer } =
      await import("../servers/lifecycle.js");
    const { listServerApps } = await import("../servers/service.js");
    const { HttpError } = await import("../../http/errors.js");
    const db = getTowbarDatabase();
    const workspaceId = randomUUID(),
      otherWorkspaceId = randomUUID(),
      actorUserId = randomUUID(),
      sourceId = randomUUID(),
      serverId = randomUUID(),
      appId = randomUUID();
    const manifest = normalizeDeploymentManifest({
      version: 1,
      apps: [
        {
          id: "app",
          name: "App",
          server: "192.0.2.10",
          dockerfile: "Dockerfile",
          context: ".",
          container: { port: 3000 },
          hooks: {
            preDeploy: { command: ["echo", "pre"] },
            postDeploy: { command: ["echo", "post"] },
          },
        },
      ],
      resources: [
        { id: "db", name: "DB", type: "postgres", server: "192.0.2.10" },
      ],
    });
    const serverConfig = normalizeServerConfiguration({
        ip: "192.0.2.10",
        ssh: { username: "deploy" },
        proxy: { cloudflare: { enabled: true } },
      }),
      appConfig = manifest.apps[0]!;
    const sourceOwner = { type: "source" as const, id: sourceId, workspaceId };
    const workspaceOwner = { type: "workspace" as const, workspaceId };
    const appOwner = { type: "app" as const, id: appId, workspaceId };
    const slot = {
      ...appOwner,
      environment: "production" as const,
      stage: "deployment",
    };
    const sharedSlot = {
      ...sourceOwner,
      environment: "production" as const,
      stage: "deployment",
    };
    const globalSlot = {
      ...workspaceOwner,
      environment: "production" as const,
      stage: "deployment",
    };
    let workspaceRole: "owner" | "member" = "owner",
      requestWorkspace = workspaceId;
    const api = new Hono<TowbarHonoEnvironment>();
    api.use("*", async (context, next) => {
      context.set("user", {
        id: actorUserId,
        workspaceId: requestWorkspace,
        workspaceRole,
        email: "test@example.com",
        name: "Test",
      });
      await next();
    });
    api.onError((error, context) =>
      context.json(
        {
          error:
            error instanceof HttpError
              ? error.publicMessage
              : "Invalid request",
        },
        error instanceof HttpError ? error.status : 400,
      ),
    );
    api.route("/apps/:ownerId/secrets", environmentSecretRoutes("app"));
    api.route("/sources/:ownerId/secrets", environmentSecretRoutes("source"));
    api.route("/settings/secrets", environmentSecretRoutes("workspace"));
    api.route("/servers/:serverId/credentials", serverCredentialRoutes);
    const patch = async (path: string, body: unknown) =>
      await api.request(path, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    try {
      await db.insert(workspaces).values([
        { id: workspaceId, slug: workspaceId, name: "Test" },
        { id: otherWorkspaceId, slug: otherWorkspaceId, name: "Other" },
      ]);
      await db.insert(users).values({
        id: actorUserId,
        email: `${actorUserId}@example.com`,
        displayName: "Test",
      });
      const [installation] = await db
        .insert(githubInstallations)
        .values({
          workspaceId,
          installationId: randomUUID(),
          accountLogin: "test",
          accountType: "Organization",
        })
        .returning();
      await db.insert(sources).values({
        id: sourceId,
        workspaceId,
        githubInstallationId: installation!.id,
        repositoryOwner: "test",
        repositoryName: "test",
        branch: "main",
      });
      await db.insert(servers).values({
        id: serverId,
        workspaceId,
        canonicalIp: serverConfig.ip,
        config: serverConfig,
        configDigest: "digest",
      });
      await db.insert(apps).values({
        id: appId,
        workspaceId,
        sourceId,
        serverId,
        manifestId: "app",
        name: "App",
        kind: "app",
        config: appConfig,
        configDigest: "digest",
        sourceRevision: "1234567",
      });

      await t.test(
        "one workspace server is shared by deployables from multiple Sources",
        async () => {
          const secondSourceId = randomUUID();
          const secondAppId = randomUUID();
          await db.insert(sources).values({
            id: secondSourceId,
            workspaceId,
            githubInstallationId: installation!.id,
            repositoryOwner: "test",
            repositoryName: "second",
            branch: "main",
          });
          await db.insert(apps).values({
            id: secondAppId,
            workspaceId,
            sourceId: secondSourceId,
            serverId,
            manifestId: "app",
            name: "Second app",
            kind: "app",
            config: appConfig,
            configDigest: "second-digest",
            sourceRevision: "1234567",
          });
          assert.deepEqual(
            (await listServerApps(serverId, workspaceId))
              .map((app) => app.sourceId)
              .sort(),
            [sourceId, secondSourceId].sort(),
          );
          await assert.rejects(
            createServer({ config: serverConfig, workspaceId }),
            /already configured/u,
          );
          await db.delete(sources).where(eq(sources.id, secondSourceId));
        },
      );

      await t.test(
        "empty configuration is editable without AWS; missing server credentials are actionable",
        async () => {
          const bindings = await listEnvironmentSecrets(appOwner, "production");
          assert.equal(bindings.length, 4);
          assert(bindings.every((binding) => binding.revision === null));
          await assert.rejects(
            resolveServerCredentials({ workspaceId, serverId }),
            /Server → Settings → Configuration/u,
          );
        },
      );
      const { testManagedSecretInheritance } =
        await import("./inheritance-tests.js");
      await testManagedSecretInheritance({
        t,
        db,
        workspaceId,
        actorUserId,
        sourceId,
        appId,
        workspaceOwner,
        sourceOwner,
        appOwner,
        globalSlot,
        sharedSlot,
        slot,
      });
      await t.test(
        "simultaneous first writes cannot overwrite each other",
        async () => {
          const target = { ...slot, stage: "build" };
          const outcomes = await Promise.allSettled(
            ["one", "two"].map((value) =>
              mutateSecret(
                target,
                { expectedRevision: null, set: { BUILD: value }, delete: [] },
                actorUserId,
              ),
            ),
          );
          assert.equal(
            outcomes.filter((item) => item.status === "fulfilled").length,
            1,
          );
          assert.equal(
            outcomes.filter((item) => item.status === "rejected").length,
            1,
          );
        },
      );
      await t.test(
        "member, foreign workspace, and reveal requests cannot mutate or retrieve values",
        async () => {
          const path = `/apps/${appId}/secrets/production/deployment`;
          const current = await readSecretMetadata(slot);
          const change = {
            expectedRevision: current.revision,
            set: { TOKEN: "forbidden" },
            delete: [],
          };
          workspaceRole = "member";
          assert.equal((await patch(path, change)).status, 403);
          assert.equal(
            (
              await patch("/settings/secrets/production/deployment", {
                expectedRevision: (await readSecretMetadata(globalSlot))
                  .revision,
                set: { TOKEN: "forbidden-global" },
                delete: [],
              })
            ).status,
            403,
          );
          workspaceRole = "owner";
          requestWorkspace = otherWorkspaceId;
          assert.equal((await patch(path, change)).status, 404);
          requestWorkspace = workspaceId;
          assert.equal(
            (
              await api.request(`/apps/${appId}/secrets/reveal`, {
                method: "POST",
              })
            ).status,
            404,
          );
          const response = await api.request(`/apps/${appId}/secrets`);
          assert.match(
            response.headers.get("cache-control") ?? "",
            /no-store/u,
          );
          assert(!(await response.text()).includes("shared-value"));
        },
      );
      const { testManagedSecretExecution } =
        await import("./execution-tests.js");
      await testManagedSecretExecution({
        t,
        db,
        workspaceId,
        actorUserId,
        sourceId,
        serverId,
        appId,
        appConfig,
        serverConfig,
        sharedSlot,
        patch,
        api,
        setWorkspaceRole: (role) => {
          workspaceRole = role;
        },
      });
      await t.test(
        "notification configuration comes from installation environment variables",
        () => {
          assert.equal(notificationProviderAvailability().slack, true);
          assert.equal(
            getNotificationProviderConfiguration("slack")?.provider,
            "slack",
          );
          assert.equal(notificationProviderAvailability().smtp, true);
          assert.equal(
            getNotificationProviderConfiguration("smtp")?.provider,
            "smtp",
          );
        },
      );
      await t.test(
        "archival and sync preserve secrets; tampering fails closed; deletion cascades",
        async () => {
          const syncInput = {
            commitSha: "7654321",
            sourceId,
            workspaceId,
            deploymentDigests: new Map([
              [
                appConfig.id,
                { deploymentDigest: "new-digest", sourceInputDigest: null },
              ],
            ]),
            serverIds: new Map([[serverConfig.ip, serverId]]),
          };
          await db.transaction(async (transaction) => {
            await applyDeployableAction(transaction, {
              ...syncInput,
              action: {
                action: "archive",
                id: appConfig.id,
                current: {
                  id: appId,
                  config: appConfig,
                  configDigest: "digest",
                  identity: appConfig.id,
                  archivedAt: null,
                },
              },
            });
          });
          const retained = await readSecretValues(slot);
          assert.equal(retained.values.MULTILINE, "line one\nline two");
          await db.transaction(async (transaction) => {
            await applyDeployableAction(transaction, {
              ...syncInput,
              action: {
                action: "restore",
                id: appConfig.id,
                desired: { ...appConfig, name: "Renamed" },
              },
            });
          });
          assert.equal(
            (
              await updateServer({
                config: { ...serverConfig, buildConcurrency: 2 },
                serverId,
                workspaceId,
              })
            ).id,
            serverId,
          );
          assert.match(
            (
              await db
                .select({ deploymentDigest: apps.deploymentDigest })
                .from(apps)
                .where(eq(apps.id, appId))
                .limit(1)
            )[0]!.deploymentDigest!,
            /^[a-f0-9]{64}$/u,
          );
          const newServer = await createServer({
            config: { ...serverConfig, ip: "192.0.2.11" },
            workspaceId,
          });
          assert.equal(
            (
              await readSecretMetadata({
                type: "server",
                id: newServer.id,
                workspaceId,
                environment: "production",
                stage: "credentials",
              })
            ).revision,
            null,
          );
          assert.equal(
            (await readSecretValues(slot)).revision,
            retained.revision,
          );
          const [row] = await db
            .select()
            .from(managedSecrets)
            .where(
              and(
                eq(managedSecrets.owner, `app:${appId}`),
                eq(managedSecrets.stage, "deployment"),
                eq(managedSecrets.environment, "production"),
              ),
            );
          assert(row);
          // Database ownership cannot be reassigned across a workspace even by a direct write.
          await assert.rejects(
            db
              .update(managedSecrets)
              .set({ workspaceId: otherWorkspaceId })
              .where(eq(managedSecrets.id, row.id)),
          );
          const [another] = await db
            .select()
            .from(managedSecrets)
            .where(
              and(
                eq(managedSecrets.owner, `source:${sourceId}`),
                eq(managedSecrets.stage, "deployment"),
              ),
            );
          assert(another);
          await db
            .update(managedSecrets)
            .set({ encryptedPayload: another.encryptedPayload })
            .where(eq(managedSecrets.id, row.id));
          await assert.rejects(
            readSecretValues(slot),
            /could not be unlocked/u,
          );
          await db
            .update(managedSecrets)
            .set({ encryptedPayload: row.encryptedPayload })
            .where(eq(managedSecrets.id, row.id));
          await db
            .update(managedSecrets)
            .set({
              encryptedPayload: {
                ...row.encryptedPayload,
                authenticationTag: randomBytes(16).toString("base64url"),
              },
            })
            .where(eq(managedSecrets.id, row.id));
          await assert.rejects(
            readSecretValues(slot),
            /could not be unlocked/u,
          );
          const audit = await db
            .select()
            .from(auditEvents)
            .where(eq(auditEvents.workspaceId, workspaceId));
          assert(!JSON.stringify(audit).includes("shared-value"));
          assert(!JSON.stringify(audit).includes("test-slack-token"));
          await db.delete(apps).where(eq(apps.id, appId));
          assert.equal((await readSecretMetadata(slot)).revision, null);
        },
      );
    } finally {
      await db.delete(releases).where(eq(releases.appId, appId));
      await db
        .delete(deployments)
        .where(eq(deployments.workspaceId, workspaceId));
      await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
      await db.delete(workspaces).where(eq(workspaces.id, otherWorkspaceId));
      await db.delete(users).where(eq(users.id, actorUserId));
      await closeDatabase();
    }
  },
);
