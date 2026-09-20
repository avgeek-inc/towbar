import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import {
  digestValue,
  normalizeServerConfiguration,
} from "@workspace/towbar-core";
import {
  apps,
  deployments,
  servers,
  sourceEnvironments,
  sourceSyncs,
  users,
  workspaceMembers,
  workspaces,
} from "@workspace/towbar-database/schema";
import { environmentSyncDependencies } from "./environment-sync-fixture.js";

const url = process.env.TOWBAR_TEST_DATABASE_URL;
void test(
  "member inventory sync pauses runtime automation and cannot acquire deployment authority",
  { skip: !url },
  async () => {
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
    const { withActor } = await import("../auth/actor-context.js");
    const { requestEnvironmentSync } = await import("./environments.js");
    const { executeEnvironmentSync } = await import("./environment-sync.js");
    const { seedEnvironmentTeam } =
      await import("./environment-server-tests.js");
    const database = getTowbarDatabase();
    const workspaceId = randomUUID(),
      userId = randomUUID(),
      sourceId = randomUUID();
    const actor = {
      kind: "session" as const,
      workspaceId,
      userId,
      role: "member" as const,
    };
    try {
      await seedEnvironmentTeam({ workspaceId, userId, sourceId });
      await database
        .update(workspaceMembers)
        .set({ role: "member" })
        .where(eq(workspaceMembers.userId, userId));
      const config = normalizeServerConfiguration({
        ip: "192.0.2.10",
        ssh: { username: "deploy" },
      });
      await database.insert(servers).values({
        workspaceId,
        canonicalIp: config.ip,
        config,
        configDigest: digestValue(config),
      });
      const [environment] = await database
        .insert(sourceEnvironments)
        .values({
          sourceId,
          name: "production",
          branch: "main",
          autoDeployPaused: false,
        })
        .returning();
      const input = {
        sourceId,
        environmentId: environment!.id,
        workspaceId,
        requestedBy: userId,
        deployAfterSync: false,
      };
      let enqueued = 0;
      const enqueue = () => {
        enqueued++;
        return Promise.resolve({ workflowId: "member-effect-proof" });
      };
      await assert.rejects(
        withActor(actor, () =>
          requestEnvironmentSync({ ...input, deployAfterSync: true }, enqueue),
        ),
        /access|permission/i,
      );
      assert.equal(enqueued, 0);
      assert.equal(
        (
          await database
            .select()
            .from(sourceSyncs)
            .where(eq(sourceSyncs.sourceId, sourceId))
        ).length,
        0,
      );
      await withActor(actor, () => requestEnvironmentSync(input, enqueue));
      const [job] = await database
        .select()
        .from(sourceSyncs)
        .where(eq(sourceSyncs.sourceId, sourceId));
      assert.equal(job!.deployAfterSync, false);
      const grants = job!.requestedByActor?.grants;
      assert(grants);
      assert(grants.includes("repository.sync"));
      assert.equal(grants.includes("deployment.create"), false);
      assert.equal(grants.includes("server.prepare"), false);
      const dependencies = environmentSyncDependencies(() => ({
        root: "version: 2\nenvironments:\n  production: {}\n  staging: {}\n",
        snapshotCommit: "a".repeat(40),
        keys: [],
        broken: false,
      }));
      await executeEnvironmentSync(job!.id, workspaceId, dependencies);
      const [synced] = await database
        .select()
        .from(sourceSyncs)
        .where(eq(sourceSyncs.id, job!.id));
      assert.equal(synced!.status, "succeeded");
      assert.equal(
        (await database.select().from(apps).where(eq(apps.sourceId, sourceId)))
          .length,
        1,
      );
      const [mapped] = await database
        .select()
        .from(sourceEnvironments)
        .where(eq(sourceEnvironments.id, environment!.id));
      assert.equal(mapped!.autoDeployPaused, true);
      assert.equal(
        (
          await database
            .select()
            .from(deployments)
            .where(eq(deployments.workspaceId, workspaceId))
        ).length,
        0,
      );
      const [server] = await database
        .select()
        .from(servers)
        .where(eq(servers.workspaceId, workspaceId));
      assert.equal(server!.preparedAt, null);
      await withActor(actor, () => requestEnvironmentSync(input, enqueue));
      const [pending] = (
        await database
          .select()
          .from(sourceSyncs)
          .where(eq(sourceSyncs.sourceId, sourceId))
      ).filter((row) => row.status === "queued");
      assert(pending);
      await database
        .update(workspaceMembers)
        .set({ role: "viewer" })
        .where(eq(workspaceMembers.userId, userId));
      await assert.rejects(
        executeEnvironmentSync(pending.id, workspaceId, dependencies),
        /access|permission|role/i,
      );
    } finally {
      await database.delete(workspaces).where(eq(workspaces.id, workspaceId));
      await database.delete(users).where(eq(users.id, userId));
      await closeDatabase();
    }
  },
);
