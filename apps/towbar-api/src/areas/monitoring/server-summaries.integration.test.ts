import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import {
  aggregateMonitoringValues,
  normalizeServerConfiguration,
} from "@workspace/towbar-core";
import {
  monitoringAgents,
  monitoringSamples,
  servers,
  workspaces,
} from "@workspace/towbar-database/schema";

const databaseUrl = process.env.TOWBAR_TEST_DATABASE_URL;
void test(
  "server Scout summaries are bounded, scoped, and report-based",
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
    const { getServerMonitoringSummaries } =
      await import("./server-summaries.js");
    const db = getTowbarDatabase();
    const workspaceId = randomUUID(),
      foreignWorkspace = randomUUID();
    const online = randomUUID(),
      offline = randomUUID(),
      disabled = randomUUID(),
      archived = randomUUID(),
      foreign = randomUUID();
    const now = new Date("2026-09-06T12:00:00Z");
    try {
      await db.insert(workspaces).values(
        [workspaceId, foreignWorkspace].map((id) => ({
          id,
          slug: id,
          name: "Scout summary test",
        })),
      );
      await db.insert(servers).values(
        [online, offline, disabled, archived, foreign].map((id, index) => ({
          id,
          workspaceId: id === foreign ? foreignWorkspace : workspaceId,
          canonicalIp: `192.0.2.${210 + index}`,
          config: normalizeServerConfiguration({
            ip: `192.0.2.${210 + index}`,
            ssh: { username: "deploy" },
          }),
          configDigest: "test",
          archivedAt: null,
        })),
      );
      await db.insert(monitoringAgents).values(
        [online, offline, disabled, archived, foreign].map((serverId) => ({
          serverId,
          desiredState: serverId === disabled ? "disabled" : "enabled",
          status: serverId === disabled ? "disabled" : "online",
          lastCollectedAt: new Date(
            now.getTime() - (serverId === offline ? 120_000 : 30_000),
          ),
        })),
      );
      const metric = (cpuPercent: number) =>
        aggregateMonitoringValues({ cpuPercent, memoryPercent: 40 });
      await db.insert(monitoringSamples).values([
        ...Array.from({ length: 63 }, (_, index) => ({
          serverId: online,
          entityId: "host",
          resolution: 30,
          bucketAt: new Date(now.getTime() - (index - 1) * 30_000),
          metrics:
            index === 1
              ? { cpuPercent: { sum: 20, count: 2, min: 5, max: 15 } }
              : metric(index),
        })),
        {
          serverId: online,
          entityId: "container",
          resolution: 30,
          bucketAt: now,
          metrics: metric(99),
        },
        {
          serverId: online,
          entityId: "host",
          resolution: 60,
          bucketAt: now,
          metrics: metric(99),
        },
        ...[offline, disabled, archived, foreign].map((serverId) => ({
          serverId,
          entityId: "host",
          resolution: 30,
          bucketAt: now,
          metrics: metric(25),
        })),
      ]);
      await db
        .update(servers)
        .set({ archivedAt: now })
        .where(eq(servers.id, archived));
      const summaries = await getServerMonitoringSummaries(workspaceId, now);
      assert.deepEqual(
        [...summaries.keys()].sort(),
        [online, offline, disabled].sort(),
      );
      const active = summaries.get(online)!;
      assert.equal(active.status, "online");
      assert.equal(active.points.length, 60);
      assert.equal(active.points.at(-1)?.cpuPercent, 10);
      assert.equal(active.points.at(-1)?.memoryPercent, null);
      assert.equal(active.points[0]?.cpuPercent, 60);
      assert.equal(active.points[0]?.memoryPercent, 40);
      assert(
        active.points.every(
          (point) =>
            Date.parse(point.at) > now.getTime() - 1_800_000 &&
            Date.parse(point.at) <= now.getTime(),
        ),
      );
      assert.equal(summaries.get(offline)?.status, "offline");
      assert.deepEqual(summaries.get(offline)?.points, []);
      assert.equal(summaries.get(disabled)?.enabled, false);
      assert.deepEqual(summaries.get(disabled)?.points, []);
      const { getWorkspaceMonitoringSummary } =
        await import("./workspace-summary.js");
      await db
        .update(monitoringSamples)
        .set({
          metrics: aggregateMonitoringValues({
            cpuPercent: 99,
            diskPercent: 99,
          }),
        })
        .where(
          inArray(monitoringSamples.serverId, [
            online,
            offline,
            disabled,
            archived,
            foreign,
          ]),
        );
      assert.deepEqual(await getWorkspaceMonitoringSummary(workspaceId, now), {
        activeIncidents: 0,
        pressuredEntities: 1,
      });
      assert.deepEqual(await getWorkspaceMonitoringSummary(randomUUID(), now), {
        activeIncidents: 0,
        pressuredEntities: 0,
      });
      await db
        .update(monitoringSamples)
        .set({
          metrics: aggregateMonitoringValues({
            cpuPercent: 80,
            diskPercent: 80,
          }),
        })
        .where(
          and(
            eq(monitoringSamples.serverId, online),
            eq(monitoringSamples.bucketAt, now),
          ),
        );
      assert.equal(
        (await getWorkspaceMonitoringSummary(workspaceId, now))
          .pressuredEntities,
        0,
      );
      assert.equal(
        (await getServerMonitoringSummaries(randomUUID(), now)).size,
        0,
      );
    } finally {
      await db
        .delete(workspaces)
        .where(inArray(workspaces.id, [workspaceId, foreignWorkspace]));
      await closeDatabase();
    }
  },
);
