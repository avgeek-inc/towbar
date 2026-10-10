import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import {
  monitoringSampleSchema,
  normalizeServerConfiguration,
} from "@workspace/towbar-core";
import {
  monitoringAgents,
  serverChecks,
  serverEvents,
  serverObservations,
  servers,
  workspaces,
} from "@workspace/towbar-database/schema";

const databaseUrl = process.env.TOWBAR_TEST_DATABASE_URL;
void test(
  "host lifecycle events and metadata survive replay, rollup, and checks",
  { skip: !databaseUrl },
  async () => {
    assert(databaseUrl && new URL(databaseUrl).pathname.endsWith("_test"));
    const isolatedName = `towbar_host_${randomUUID().replaceAll("-", "")}_test`;
    const admin = postgres(databaseUrl, { max: 1, onnotice() {} });
    await admin.unsafe(`CREATE DATABASE "${isolatedName}"`);
    const isolatedUrl = new URL(databaseUrl);
    isolatedUrl.pathname = `/${isolatedName}`;
    process.env.DATABASE_TOWBAR_URL = isolatedUrl.toString();
    process.env.TOWBAR_CREDENTIALS_KEY = randomBytes(32).toString("base64");
    process.env.TOWBAR_INTERNAL_HMAC_SECRET = randomBytes(32).toString("hex");
    const { runTowbarMigrations } =
      await import("@workspace/towbar-database/migrate");
    await runTowbarMigrations({
      databaseUrl: isolatedUrl.toString(),
      logger: { info() {}, error() {} },
    });
    const { getTowbarDatabase, closeDatabase } =
      await import("../../infrastructure/database.js");
    const { ingestMonitoringSample, hashAgentToken } =
      await import("./ingest.js");
    const { observeServer, observeServerCheck, hardwareChange } =
      await import("./server-observations.js");
    const { getMonitoringHistory } = await import("./queries.js");
    const { getServer } = await import("../servers/service.js");
    const { maintainMonitoringMetrics } = await import("./retention.js");
    const db = getTowbarDatabase();
    const workspaceId = randomUUID(),
      serverId = randomUUID(),
      generation = randomUUID();
    const bootA = randomUUID(),
      bootB = randomUUID();
    const base = new Date("2026-10-10T11:30:00Z");
    const sample = (
      offset: number,
      bootId = bootA,
      type = "r8g.medium",
      cores = 1,
      memory = 8,
    ) =>
      monitoringSampleSchema.parse({
        id: randomBytes(16).toString("hex"),
        collectedAt: new Date(+base + offset).toISOString(),
        version: "1.3.0",
        collectionDurationMs: 1,
        collectionErrors: 0,
        droppedSamples: 0,
        host: {
          bootId,
          bootStartedAt: new Date(
            +base + (bootId === bootB ? 45_000 : -3600_000),
          ).toISOString(),
          instance: { provider: "aws", type },
        },
        entities: [
          {
            id: "host",
            metrics: { cpuCores: cores, memoryTotalBytes: memory * 1024 ** 3 },
          },
        ],
      });
    try {
      await db
        .insert(workspaces)
        .values({ id: workspaceId, slug: workspaceId, name: "Host lifecycle" });
      await db.insert(servers).values({
        id: serverId,
        workspaceId,
        canonicalIp: "192.0.2.219",
        config: normalizeServerConfiguration({
          ip: "192.0.2.219",
          ssh: { username: "deploy" },
        }),
        configDigest: "test",
      });
      await db.insert(monitoringAgents).values({
        serverId,
        generation,
        desiredState: "enabled",
        status: "online",
        tokenHash: hashAgentToken("test"),
      });
      await ingestMonitoringSample(serverId, generation, sample(0), base);
      assert.equal(
        (
          await db
            .select()
            .from(serverEvents)
            .where(eq(serverEvents.serverId, serverId))
        ).length,
        0,
        "initial observation is a baseline",
      );
      await ingestMonitoringSample(
        serverId,
        generation,
        sample(30_000),
        new Date(+base + 30_000),
      );
      assert.equal(
        (
          await db
            .select()
            .from(serverEvents)
            .where(eq(serverEvents.serverId, serverId))
        ).length,
        0,
        "sender/collector restart is not a host reboot",
      );
      const changed = sample(60_000, bootB, "r8g.large", 2, 16);
      const now = new Date(+base + 120_000);
      await Promise.all([
        ingestMonitoringSample(serverId, generation, changed, now),
        ingestMonitoringSample(serverId, generation, changed, now),
      ]);
      await ingestMonitoringSample(serverId, generation, sample(15_000), now);
      await db.transaction((tx) =>
        observeServer(tx, serverId, {
          at: new Date(+base + 10_000),
          hardware: {
            instance: { provider: "aws", type: "r8g.medium" },
            cpuCount: 1,
            memoryBytes: 8 * 1024 ** 3,
          },
        }),
      );
      const events = await db
        .select()
        .from(serverEvents)
        .where(eq(serverEvents.serverId, serverId));
      assert.deepEqual(events.map((event) => event.type).sort(), [
        "host-restart",
        "instance-change",
      ]);
      assert.equal(
        events.find((event) => event.type === "host-restart")?.at.toISOString(),
        new Date(+base + 45_000).toISOString(),
      );
      assert.equal(
        events.find((event) => event.type === "instance-change")?.detail,
        "r8g.medium → r8g.large",
      );
      assert.equal(
        (await getServer(serverId, workspaceId)).hardware?.instance?.type,
        "r8g.large",
      );
      assert.equal(
        (await getServer(serverId, workspaceId)).hardware?.cpuCount,
        2,
      );
      const history = await getMonitoringHistory(
        { serverId, workspaceId, range: "1h" },
        now,
      );
      assert.equal(
        history.events.filter((event) => event.type === "host-restart").length,
        1,
      );
      const narrow = await getMonitoringHistory(
        {
          serverId,
          workspaceId,
          range: "custom",
          startAt: base.toISOString(),
          endAt: new Date(+base + 40_000).toISOString(),
        },
        now,
      );
      assert.equal(narrow.events.length, 0);
      const checkedServer = randomUUID();
      await db.insert(servers).values({
        id: checkedServer,
        workspaceId,
        canonicalIp: "192.0.2.220",
        config: normalizeServerConfiguration({
          ip: "192.0.2.220",
          ssh: { username: "deploy" },
        }),
        configDigest: "test",
      });
      await db.insert(serverChecks).values({
        serverId: checkedServer,
        status: "succeeded",
        createdAt: new Date(+base - 60_000),
        startedAt: new Date(+base - 30_000),
        result: {
          host: {
            instance: { provider: "gcp", type: "e2-standard-4" },
            cpuLogicalCount: 4,
            memoryTotalKb: 16 * 1024 ** 2,
          },
        },
      });
      await db.transaction((tx) =>
        observeServer(tx, checkedServer, {
          at: new Date(+base + 90_000),
          hardware: {
            instance: null,
            cpuCount: 8,
            memoryBytes: 32 * 1024 ** 3,
          },
        }),
      );
      const [check] = await db
        .insert(serverChecks)
        .values({
          serverId: checkedServer,
          status: "succeeded",
          createdAt: new Date(+base + 50_000),
          startedAt: new Date(+base + 70_000),
          result: {
            host: {
              instance: { provider: "gcp", type: "e2-standard-8" },
              cpuLogicalCount: 4,
              memoryTotalKb: 16 * 1024 ** 2,
            },
          },
        })
        .returning();
      assert(check);
      await db.transaction((tx) => observeServerCheck(tx, check));
      await db.transaction((tx) => observeServerCheck(tx, check));
      const checkedHardware = (await getServer(checkedServer, workspaceId))
        .hardware;
      assert.equal(
        checkedHardware?.instance?.type,
        "e2-standard-8",
        "type-only check must not be blocked by newer Scout capacity",
      );
      assert.equal(
        checkedHardware?.cpuCount,
        8,
        "older check capacity must not replace newer Scout capacity",
      );
      assert.equal(
        (
          await db
            .select()
            .from(serverEvents)
            .where(eq(serverEvents.serverId, checkedServer))
        ).filter((event) => event.type === "instance-change").length,
        1,
      );
      await maintainMonitoringMetrics(new Date(+base + 2 * 86400_000));
      assert.equal(
        (
          await db
            .select()
            .from(serverEvents)
            .where(eq(serverEvents.serverId, serverId))
        ).length,
        2,
        "rollup must preserve lifecycle events",
      );
      const hardware = {
        instance: null,
        cpuCount: 2,
        memoryBytes: 16 * 1024 ** 3,
      };
      assert.equal(
        hardwareChange(hardware, {
          ...hardware,
          memoryBytes: hardware.memoryBytes * 0.999,
        }),
        null,
      );
      assert.equal(
        hardwareChange(hardware, { ...hardware, cpuCount: 4 })?.type,
        "capacity-change",
      );
      await maintainMonitoringMetrics(new Date(+base + 16 * 86400_000));
      assert.equal(
        (
          await db
            .select()
            .from(serverEvents)
            .where(eq(serverEvents.serverId, serverId))
        ).length,
        0,
        "events follow server retention",
      );
      assert.equal(
        (
          await db
            .select()
            .from(serverObservations)
            .where(eq(serverObservations.serverId, serverId))
        )[0]?.bootId,
        bootB,
      );
      const legacy = sample(90_000);
      delete legacy.host;
      assert(monitoringSampleSchema.safeParse(legacy).success);
      const futureBoot = sample(90_000);
      futureBoot.host!.bootStartedAt = new Date(+now + 3600_000).toISOString();
      assert(!monitoringSampleSchema.safeParse(futureBoot).success);
    } finally {
      await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
      await closeDatabase();
      await admin.unsafe(`DROP DATABASE "${isolatedName}"`);
      await admin.end();
    }
  },
);
