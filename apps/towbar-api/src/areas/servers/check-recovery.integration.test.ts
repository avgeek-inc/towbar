import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";

import { normalizeServerConfiguration } from "@workspace/towbar-core";
import {
  serverChecks,
  servers,
  workspaces,
} from "@workspace/towbar-database/schema";

const databaseUrl = process.env.TOWBAR_TEST_DATABASE_URL;

void test(
  "interrupted checks recover without overwriting a completed result",
  { skip: !databaseUrl },
  async () => {
    assert(databaseUrl && new URL(databaseUrl).pathname.endsWith("_test"));
    process.env.DATABASE_TOWBAR_URL = databaseUrl;
    process.env.TOWBAR_CREDENTIALS_KEY = randomBytes(32).toString("base64");
    process.env.TOWBAR_INTERNAL_HMAC_SECRET = randomBytes(32).toString("hex");
    const { runTowbarMigrations } =
      await import("@workspace/towbar-database/migrate");
    await runTowbarMigrations({
      databaseUrl,
      logger: { info() {}, error() {} },
    });
    const { getTowbarDatabase, closeDatabase } =
      await import("../../infrastructure/database.js");
    const { markServerCheckInterrupted, recoverInterruptedServerChecks } =
      await import("./checks.js");
    const { finishServerCheck } = await import("./service.js");
    const db = getTowbarDatabase();
    const workspaceId = randomUUID();
    const serverId = randomUUID();
    const oldRunningId = randomUUID();
    const freshRunningId = randomUUID();
    const queuedId = randomUUID();
    const succeededId = randomUUID();
    const now = new Date("2026-09-24T12:00:00.000Z");
    const config = normalizeServerConfiguration({
      ip: "192.0.2.240",
      ssh: { username: "deploy" },
    });
    try {
      await db.insert(workspaces).values({
        id: workspaceId,
        slug: workspaceId,
        name: "Check recovery test",
      });
      await db.insert(servers).values({
        id: serverId,
        workspaceId,
        canonicalIp: config.ip,
        config,
        configDigest: "test",
      });
      await db.insert(serverChecks).values([
        {
          id: oldRunningId,
          serverId,
          status: "running",
          startedAt: new Date(now.getTime() - 4 * 60_000),
          createdAt: new Date(now.getTime() - 4 * 60_000),
        },
        {
          id: freshRunningId,
          serverId,
          status: "running",
          startedAt: new Date(now.getTime() - 2 * 60_000),
          createdAt: new Date(now.getTime() - 2 * 60_000),
        },
        {
          id: queuedId,
          serverId,
          status: "queued",
          createdAt: new Date(now.getTime() - 60 * 60_000),
        },
        {
          id: succeededId,
          serverId,
          status: "succeeded",
          result: { operatingSystem: "Ubuntu" },
          finishedAt: new Date(now.getTime() - 5 * 60_000),
        },
      ]);

      assert.equal(await recoverInterruptedServerChecks(now), 1);
      assert.equal(await recoverInterruptedServerChecks(now), 0);
      const [recovered] = await db
        .select()
        .from(serverChecks)
        .where(eq(serverChecks.id, oldRunningId));
      assert.equal(recovered?.status, "failed");
      assert.equal(recovered?.errorCode, "SERVER_CHECK_INTERRUPTED");
      assert.deepEqual(recovered?.finishedAt, now);

      await finishServerCheck(oldRunningId, {
        status: "succeeded",
        result: { operatingSystem: "late result" },
      });
      const [unchanged] = await db
        .select()
        .from(serverChecks)
        .where(eq(serverChecks.id, oldRunningId));
      assert.equal(unchanged?.status, "failed");
      assert.equal(unchanged?.result, null);

      assert.equal(
        (await markServerCheckInterrupted(queuedId)).status,
        "failed",
      );
      assert.equal(
        (await markServerCheckInterrupted(queuedId)).status,
        "failed",
      );
      assert.equal(
        (await markServerCheckInterrupted(succeededId)).status,
        "succeeded",
      );
      const [fresh] = await db
        .select()
        .from(serverChecks)
        .where(eq(serverChecks.id, freshRunningId));
      assert.equal(fresh?.status, "running");
    } finally {
      await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
      await closeDatabase();
    }
  },
);
