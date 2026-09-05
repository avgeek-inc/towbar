import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import {
  normalizeDeploymentManifest,
  normalizeServerConfiguration,
} from "@workspace/towbar-core";
import {
  apps,
  githubInstallations,
  managedSecrets,
  serverChecks,
  serverDeployableOwnership,
  serverPreparations,
  servers,
  sources,
  sshHostKeys,
  users,
  workspaces,
} from "@workspace/towbar-database/schema";
import type { TowbarHonoEnvironment } from "../../http/types.js";

const url = process.env.TOWBAR_TEST_DATABASE_URL;
void test(
  "server removal and ownership retained after source deletion",
  { skip: !url },
  async (t) => {
    assert(url && new URL(url).pathname.endsWith("_test"));
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
    const { removeServer, createServer } = await import("./lifecycle.js");
    const { deleteSource } = await import("../sources/service.js");
    const { getCleanupExpected } =
      await import("../resource-operations/queries.js");
    const { serverRoutes } = await import("../../routes/v1/core/servers.js");
    const { mutateSecret } = await import("../secrets/store.js");
    const { HttpError } = await import("../../http/errors.js");
    const db = getTowbarDatabase();
    const workspaceId = randomUUID(),
      userId = randomUUID(),
      sourceId = randomUUID(),
      appId = randomUUID();
    const config = normalizeServerConfiguration({
      ip: "192.0.2.111",
      ssh: { username: "deploy" },
    });
    let serverId = "";
    try {
      await db
        .insert(workspaces)
        .values({ id: workspaceId, slug: workspaceId, name: "Removal test" });
      await db.insert(users).values({
        id: userId,
        email: `${userId}@example.com`,
        displayName: "Test",
      });
      const server = await createServer({ config, workspaceId });
      serverId = server.id;
      const removal = { serverId, workspaceId, requestedBy: userId };
      const [installation] = await db
        .insert(githubInstallations)
        .values({
          workspaceId,
          installationId: randomUUID(),
          accountLogin: "example",
          accountType: "Organization",
        })
        .returning();
      await db.insert(sources).values({
        id: sourceId,
        workspaceId,
        githubInstallationId: installation!.id,
        repositoryOwner: "example",
        repositoryName: "platform",
        branch: "main",
      });
      const manifest = normalizeDeploymentManifest({
        version: 1,
        apps: [
          {
            id: "app",
            name: "App",
            server: config.ip,
            dockerfile: "Dockerfile",
            context: ".",
            container: { port: 3000 },
            health: { path: "/health" },
          },
        ],
      });
      const values = {
        id: appId,
        workspaceId,
        sourceId,
        serverId,
        manifestId: "app",
        name: "App",
        config: manifest.apps[0]!,
        configDigest: "test",
        sourceRevision: "1234567",
      };
      await db.insert(apps).values(values);
      await t.test("owner and workspace boundaries", async () => {
        const api = new Hono<TowbarHonoEnvironment>();
        api.use("*", async (c, next) => {
          c.set("user", {
            id: userId,
            workspaceId,
            workspaceRole: "member",
            email: "test@example.com",
            name: "Test",
          });
          await next();
        });
        api.onError((error, c) =>
          c.json(
            { error: error.message },
            error instanceof HttpError ? error.status : 500,
          ),
        );
        api.route("/servers", serverRoutes);
        assert.equal(
          (await api.request(`/servers/${serverId}`, { method: "DELETE" }))
            .status,
          403,
        );
        await assert.rejects(
          removeServer({ ...removal, workspaceId: randomUUID() }),
          (error: unknown) =>
            error instanceof HttpError && error.status === 404,
        );
      });
      await t.test("registered workloads prevent removal", async () => {
        await assert.rejects(removeServer(removal), /Move or remove/);
      });
      await t.test(
        "source deletion retains cleanup ownership but removes inventory",
        async () => {
          await deleteSource(sourceId, workspaceId);
          assert.equal(
            (await db.select().from(apps).where(eq(apps.id, appId))).length,
            0,
          );
          const expected = await getCleanupExpected(serverId);
          assert.deepEqual(expected.deployableIds, []);
          assert.deepEqual(expected.ownedDeployableIds, [appId]);
        },
      );
      await t.test(
        "migration recovers ownership from retained checks",
        async () => {
          const historicalId = randomUUID();
          await db.insert(serverChecks).values({
            serverId,
            status: "succeeded",
            result: {
              runtime: [
                { deployableId: historicalId },
                { deployableId: "malformed" },
              ],
            },
          });
          const migration = await readFile(
            new URL(
              "../../../../../packages/towbar-database/drizzle/0041_strong_gwen_stacy.sql",
              import.meta.url,
            ),
            "utf8",
          );
          const backfill = migration
            .split("--> statement-breakpoint")
            .find((part) => part.includes("SELECT c.server_id"));
          assert(backfill);
          await db.execute(sql.raw(backfill));
          assert(
            (await getCleanupExpected(serverId)).ownedDeployableIds.includes(
              historicalId,
            ),
          );
        },
      );
      await t.test(
        "queued checks and preparations prevent removal",
        async () => {
          const [check] = await db
            .insert(serverChecks)
            .values({ serverId })
            .returning();
          await assert.rejects(
            removeServer(removal),
            /active server operations/,
          );
          await db
            .update(serverChecks)
            .set({ status: "succeeded" })
            .where(eq(serverChecks.id, check!.id));
          const [preparation] = await db
            .insert(serverPreparations)
            .values({ serverId, configDigest: "test", steps: [] })
            .returning();
          await assert.rejects(
            removeServer(removal),
            /active server operations/,
          );
          await db
            .update(serverPreparations)
            .set({ status: "succeeded" })
            .where(eq(serverPreparations.id, preparation!.id));
        },
      );
      await db.insert(sshHostKeys).values({
        serverId,
        algorithm: "ssh-ed25519",
        fingerprint: "SHA256:test",
        publicKey: "test",
        trustedBy: userId,
      });
      await mutateSecret(
        {
          type: "server",
          id: serverId,
          workspaceId,
          environment: "production",
          stage: "credentials",
        },
        {
          expectedRevision: null,
          set: { privateKey: "test-private-key" },
          delete: [],
        },
        userId,
      );
      await t.test(
        "removal forgets credentials and trust, preserves history, and rejects late work",
        async () => {
          await removeServer(removal);
          assert(
            (
              await db.select().from(servers).where(eq(servers.id, serverId))
            )[0]!.archivedAt,
          );
          assert.equal(
            (
              await db
                .select()
                .from(managedSecrets)
                .where(eq(managedSecrets.serverId, serverId))
            ).length,
            0,
          );
          assert(
            (
              await db
                .select()
                .from(sshHostKeys)
                .where(eq(sshHostKeys.serverId, serverId))
            )[0]!.revokedAt,
          );
          assert(
            (
              await db
                .select()
                .from(serverChecks)
                .where(eq(serverChecks.serverId, serverId))
            ).length > 0,
          );
          assert(
            (
              await db
                .select()
                .from(serverDeployableOwnership)
                .where(eq(serverDeployableOwnership.serverId, serverId))
            ).length > 0,
          );
          await assert.rejects(db.insert(serverChecks).values({ serverId }));
          await assert.rejects(
            db
              .insert(serverPreparations)
              .values({ serverId, configDigest: "test", steps: [] }),
          );
          const revived = await createServer({ config, workspaceId });
          assert.equal(revived.id, serverId);
          assert.equal(revived.setupStatus, "pending");
        },
      );
    } finally {
      await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
      await db.delete(users).where(eq(users.id, userId));
      await closeDatabase();
    }
  },
);
