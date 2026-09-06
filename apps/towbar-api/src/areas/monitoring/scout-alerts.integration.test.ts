import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq, isNull } from "drizzle-orm";
import {
  aggregateMonitoringValues,
  normalizeServerConfiguration,
  scoutAlertPresets,
  scoutAlertRuleSchema,
} from "@workspace/towbar-core";
import {
  monitoringAgents,
  monitoringSamples,
  notificationDeliveries,
  notificationDestinations,
  notificationEvents,
  scoutAlertIncidents,
  scoutAlertRules,
  servers,
  users,
  workspaces,
} from "@workspace/towbar-database/schema";

const databaseUrl = process.env.TOWBAR_TEST_DATABASE_URL;
void test(
  "Scout durable alert lifecycle, scoping, and delivery outbox",
  { skip: !databaseUrl },
  async (t) => {
    assert(databaseUrl && new URL(databaseUrl).pathname.endsWith("_test"));
    process.env.DATABASE_TOWBAR_URL = databaseUrl;
    process.env.TOWBAR_CREDENTIALS_KEY = randomBytes(32).toString("base64");
    process.env.TOWBAR_INTERNAL_HMAC_SECRET = randomBytes(32).toString("hex");
    process.env.TOWBAR_SLACK_BOT_TOKEN = "fixture-no-external-delivery";
    const { runTowbarMigrations } =
      await import("@workspace/towbar-database/migrate");
    await runTowbarMigrations({
      databaseUrl,
      logger: { info() {}, error() {} },
    });
    const { getTowbarDatabase, closeDatabase } =
      await import("../../infrastructure/database.js");
    const {
      saveScoutAlertRule,
      muteScoutAlerts,
      deleteScoutAlertRule,
      listScoutAlertRules,
    } = await import("./alert-rules.js");
    const { evaluateScoutAlerts } = await import("./alert-evaluator.js");
    const db = getTowbarDatabase();
    const workspaceId = randomUUID(),
      otherWorkspace = randomUUID(),
      serverId = randomUUID(),
      userId = randomUUID(),
      destinationId = randomUUID();
    const scope = { serverId, workspaceId, requestedBy: userId };
    const now = new Date("2026-09-06T12:00:00Z");
    let ruleId: string;
    const pending = async () =>
      db
        .select()
        .from(notificationDeliveries)
        .innerJoin(
          notificationEvents,
          eq(notificationEvents.id, notificationDeliveries.eventId),
        )
        .where(eq(notificationEvents.workspaceId, workspaceId));
    const active = async () =>
      db
        .select()
        .from(scoutAlertIncidents)
        .where(
          and(
            eq(scoutAlertIncidents.ruleId, ruleId),
            isNull(scoutAlertIncidents.resolvedAt),
          ),
        );
    const sweep = (at: Date) => evaluateScoutAlerts(at, async () => {});
    const samples = async (end: Date, value: number, length = 11) => {
      await db
        .insert(monitoringSamples)
        .values(
          Array.from({ length }, (_, i) => ({
            serverId,
            entityId: "host",
            bucketAt: new Date(end.getTime() - (length - i - 1) * 30_000),
            metrics: aggregateMonitoringValues({ memoryPercent: value }),
          })),
        )
        .onConflictDoNothing();
      await db
        .update(monitoringAgents)
        .set({ lastCollectedAt: end, lastReportAt: end })
        .where(eq(monitoringAgents.serverId, serverId));
    };
    try {
      await db.insert(workspaces).values([
        { id: workspaceId, slug: workspaceId, name: "Scout test" },
        { id: otherWorkspace, slug: otherWorkspace, name: "Other tenant" },
      ]);
      await db
        .insert(users)
        .values({
          id: userId,
          email: `${userId}@example.com`,
          displayName: "Scout tester",
        });
      await db
        .insert(servers)
        .values({
          id: serverId,
          workspaceId,
          canonicalIp: "192.0.2.201",
          config: normalizeServerConfiguration({
            ip: "192.0.2.201",
            ssh: { username: "deploy" },
          }),
          configDigest: "fixture",
        });
      await db
        .insert(monitoringAgents)
        .values({
          serverId,
          desiredState: "enabled",
          status: "online",
          lastCollectedAt: now,
        });
      await db
        .insert(notificationDestinations)
        .values({
          id: destinationId,
          workspaceId,
          serverId,
          provider: "slack",
          config: { channelId: "CFIXTURE" },
          categories: ["scout"],
          enabled: true,
        });
      const rule = scoutAlertRuleSchema.parse({
        name: "Memory pressure",
        condition: scoutAlertPresets.find((p) => p.id === "memory")!.condition,
        destinationIds: [destinationId],
      });
      await t.test(
        "owner service validates tenant, workload, and destination boundaries",
        async () => {
          await assert.rejects(
            saveScoutAlertRule({ ...scope, workspaceId: otherWorkspace, rule }),
          );
          await assert.rejects(
            saveScoutAlertRule({
              ...scope,
              rule: { ...rule, deployableId: randomUUID() },
            }),
          );
          await assert.rejects(
            saveScoutAlertRule({
              ...scope,
              rule: { ...rule, destinationIds: [randomUUID()] },
            }),
          );
          await assert.rejects(
            listScoutAlertRules({ serverId, workspaceId: otherWorkspace }),
          );
          ruleId = (await saveScoutAlertRule({ ...scope, rule })).id;
        },
      );
      await t.test(
        "concurrent evaluations create one incident and one durable delivery",
        async () => {
          await samples(now, 95);
          await Promise.all([sweep(now), sweep(now)]);
          assert.equal((await active()).length, 1);
          assert.equal((await pending()).length, 1);
          await sweep(new Date(now.getTime() + 30_000));
          assert.equal((await pending()).length, 1);
        },
      );
      await t.test(
        "a missing report does not recover the incident",
        async () => {
          await sweep(new Date(now.getTime() + 180_000));
          assert.equal((await active()).length, 1);
          const [state] = await db
            .select()
            .from(scoutAlertRules)
            .where(eq(scoutAlertRules.id, ruleId));
          assert.equal(state?.evaluationState, "unknown");
        },
      );
      await t.test(
        "sustained recovery creates exactly one recovery notification",
        async () => {
          // Simulate a provider acknowledgement without contacting an external service.
          const first = (await pending())[0]!;
          await db
            .update(notificationDeliveries)
            .set({ state: "succeeded" })
            .where(
              eq(
                notificationDeliveries.id,
                first.towbar_notification_deliveries.id,
              ),
            );
          const recoveredAt = new Date(now.getTime() + 360_000);
          await samples(recoveredAt, 70, 5);
          await sweep(recoveredAt);
          assert.equal((await active()).length, 0);
          assert.equal((await pending()).length, 2);
          const events = await db
            .select()
            .from(notificationEvents)
            .where(eq(notificationEvents.workspaceId, workspaceId));
          assert.equal(
            events.filter((e) => e.type === "scout.recovered").length,
            1,
          );
          assert.equal(
            events.find((e) => e.type === "scout.recovered")?.payload.details
              .value,
            70,
          );
        },
      );
      await t.test(
        "muted incidents are tracked but do not send firing or orphan recovery",
        async () => {
          const mutedAt = new Date(now.getTime() + 720_000);
          await muteScoutAlerts(
            { ...scope, durationSeconds: 3600, reason: "Maintenance" },
            mutedAt,
          );
          await samples(mutedAt, 97);
          await sweep(mutedAt);
          assert.equal((await active()).length, 1);
          assert.equal((await pending()).length, 2);
          const recoveredAt = new Date(mutedAt.getTime() + 300_000);
          await samples(recoveredAt, 50, 5);
          await muteScoutAlerts(
            { ...scope, durationSeconds: 0, reason: "" },
            recoveredAt,
          );
          await sweep(recoveredAt);
          assert.equal((await active()).length, 0);
          assert.equal((await pending()).length, 2);
        },
      );
      await t.test(
        "changing conditions closes history without claiming recovery",
        async () => {
          const at = new Date(now.getTime() + 1500_000);
          await samples(at, 96);
          await sweep(at);
          const before = (await pending()).length;
          await saveScoutAlertRule({
            ...scope,
            ruleId,
            rule: { ...rule, condition: { ...rule.condition, threshold: 99 } },
          });
          assert.equal((await active()).length, 0);
          assert.equal((await pending()).length, before);
          const incidents = await db
            .select()
            .from(scoutAlertIncidents)
            .where(eq(scoutAlertIncidents.ruleId, ruleId));
          assert(incidents.some((i) => i.resolutionReason === "rule_changed"));
          await deleteScoutAlertRule({ ...scope, ruleId });
          assert.equal((await listScoutAlertRules(scope)).rules.length, 0);
        },
      );
    } finally {
      await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
      await db.delete(workspaces).where(eq(workspaces.id, otherWorkspace));
      await db.delete(users).where(eq(users.id, userId));
      await closeDatabase();
    }
  },
);
