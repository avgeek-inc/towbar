import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { normalizeDeploymentManifest } from "@workspace/towbar-core";
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
    const { resolveEnvironmentStage, listEnvironmentSecrets } =
      await import("../apps/secrets.js");
    const { environmentSecretRoutes } =
      await import("../../routes/v1/core/environment-secrets.js");
    const { serverCredentialRoutes } =
      await import("../../routes/v1/core/server-credentials.js");
    const { notificationSettingsRoutes } =
      await import("../../routes/v1/core/notification-settings.js");
    const {
      getNotificationProviderConfiguration,
      notificationProviderAvailability,
    } = await import("../notifications/configuration.js");
    const { applyDeployableAction, upsertServer } =
      await import("../sources/materialization.js");
    const { inspectManagedSecrets } = await import("./plan-checks.js");
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
      servers: [
        {
          ip: "192.0.2.10",
          ssh: { username: "deploy" },
          proxy: { cloudflare: { enabled: true } },
        },
      ],
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
    const serverConfig = manifest.servers[0]!,
      appConfig = manifest.apps[0]!;
    const sourceOwner = { type: "source" as const, id: sourceId, workspaceId };
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
    api.route("/servers/:serverId/credentials", serverCredentialRoutes);
    api.route("/settings/notifications", notificationSettingsRoutes);
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
        sourceId,
        canonicalIp: serverConfig.ip,
        config: serverConfig,
        configDigest: "digest",
        sourceRevision: "1234567",
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
        "empty configuration is editable without AWS; missing server credentials are actionable",
        async () => {
          const bindings = await listEnvironmentSecrets(appOwner, "production");
          assert.equal(bindings.length, 4);
          assert(bindings.every((binding) => binding.revision === null));
          await assert.rejects(
            resolveServerCredentials({ workspaceId, serverId }),
            /Server → Settings → Credentials/u,
          );
          const inspection = { manifest, sourceId, workspaceId };
          const checks = await inspectManagedSecrets(inspection);
          assert(checks.every((check) => !check.available));
          assert.deepEqual(
            await inspectManagedSecrets({
              ...inspection,
              scope: { serverIps: [], deployableIds: [] },
            }),
            [],
          );
        },
      );
      await t.test(
        "encrypted storage, write-only metadata, inheritance, and versioned writes",
        async () => {
          await mutateSecret(
            sharedSlot,
            {
              expectedRevision: null,
              set: { TOKEN: "shared-value", COMMON: "common-value" },
              delete: [],
            },
            actorUserId,
          );
          const saved = await mutateSecret(
            slot,
            {
              expectedRevision: null,
              set: {
                TOKEN: "local-value",
                MULTILINE: "line one\nline two",
                EMPTY: "",
              },
              delete: [],
            },
            actorUserId,
          );
          assert(!JSON.stringify(saved).includes("local-value"));
          const result = await resolveEnvironmentStage({
            workspaceId,
            sourceId,
            appId,
            environment: "production",
            stage: "deployment",
          });
          assert.equal(result.values.TOKEN, "local-value");
          assert.equal(result.values.COMMON, "common-value");
          const [stored] = await db
            .select()
            .from(managedSecrets)
            .where(eq(managedSecrets.owner, `app:${appId}`));
          assert(stored);
          assert(!JSON.stringify(stored).includes("local-value"));
          const deleted = await mutateSecret(
            slot,
            { expectedRevision: saved.revision, set: {}, delete: ["TOKEN"] },
            actorUserId,
          );
          assert.notEqual(deleted.revision, saved.revision);
          assert.equal(
            (
              await resolveEnvironmentStage({
                workspaceId,
                sourceId,
                appId,
                environment: "production",
                stage: "deployment",
              })
            ).values.TOKEN,
            "shared-value",
          );
          await assert.rejects(
            mutateSecret(
              slot,
              {
                expectedRevision: saved.revision,
                set: { TOKEN: "stale" },
                delete: [],
              },
              actorUserId,
            ),
            /changed after loading/u,
          );
        },
      );
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
      await t.test("preview and hook stages remain isolated", async () => {
        await mutateSecret(
          { ...sharedSlot, stage: "pre_deploy" },
          {
            expectedRevision: null,
            set: { MIGRATION: "production-only" },
            delete: [],
          },
          actorUserId,
        );
        const preview = await resolveEnvironmentStage({
          workspaceId,
          sourceId,
          appId,
          environment: "preview",
          stage: "deployment",
        });
        assert.deepEqual(preview.values, {});
        assert.deepEqual(
          (
            await resolveEnvironmentStage({
              workspaceId,
              sourceId,
              appId,
              environment: "preview",
              stage: "pre_deploy",
            })
          ).values,
          {},
        );
        assert.equal(
          (
            await resolveEnvironmentStage({
              workspaceId,
              sourceId,
              appId,
              environment: "production",
              stage: "post_deploy",
            })
          ).values.MIGRATION,
          undefined,
        );
      });
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
        "notification configuration is write-only and available to execution",
        async () => {
          const response = await patch("/settings/notifications/slack", {
            expectedRevision: null,
            set: { botToken: "test-slack-token" },
            delete: [],
          });
          assert.equal(response.status, 200);
          assert(!(await response.text()).includes("test-slack-token"));
          assert.equal(
            (await notificationProviderAvailability(workspaceId)).slack,
            true,
          );
          assert.equal(
            (await getNotificationProviderConfiguration("slack", workspaceId))
              ?.provider,
            "slack",
          );
          const smtp = await patch("/settings/notifications/smtp", {
            expectedRevision: null,
            set: {
              host: "mail.example.com",
              from: "test@example.com",
              username: "test",
              password: "test-smtp-password",
            },
            delete: [],
          });
          assert.equal(smtp.status, 200);
          assert(!(await smtp.text()).includes("test-smtp-password"));
          assert.equal(
            (await notificationProviderAvailability(workspaceId)).smtp,
            true,
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
            assert.equal(
              await upsertServer(transaction, {
                commitSha: "7654321",
                sourceId,
                workspaceId,
                action: {
                  action: "update",
                  id: serverConfig.ip,
                  desired: serverConfig,
                },
              }),
              serverId,
            );
            const newServerId = await upsertServer(transaction, {
              commitSha: "7654321",
              sourceId,
              workspaceId,
              action: {
                action: "create",
                id: "192.0.2.11",
                desired: { ...serverConfig, ip: "192.0.2.11" },
              },
            });
            assert.equal(
              (
                await readSecretMetadata(
                  {
                    type: "server",
                    id: newServerId,
                    workspaceId,
                    environment: "production",
                    stage: "credentials",
                  },
                  transaction,
                )
              ).revision,
              null,
            );
          });
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
