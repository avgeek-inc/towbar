import { assertScoutHttpChecks } from "./scout-http-test-helper.js";
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
      await db.insert(users).values({
        id: userId,
        email: `${userId}@example.com`,
        displayName: "Scout tester",
      });
      await db.insert(servers).values({
        id: serverId,
        workspaceId,
        canonicalIp: "192.0.2.201",
        config: normalizeServerConfiguration({
          ip: "192.0.2.201",
          ssh: { username: "deploy" },
        }),
        configDigest: "fixture",
      });
      await db.insert(monitoringAgents).values({
        serverId,
        desiredState: "enabled",
        status: "online",
        lastCollectedAt: now,
      });
      await db.insert(notificationDestinations).values({
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
      await t.test(
        "HTTP checks have durable claims, work without an agent, and ignore changed configuration",
        () => assertScoutHttpChecks(scope, sweep),
      );
      await t.test(
        "queued deliveries respect maintenance, destination changes and archived servers without sending",
        async () => {
          const { executeNotificationDeliveryAttempt } =
            await import("../notifications/delivery-service.js");
          const originalFetch = globalThis.fetch;
          let outbound = 0;
          globalThis.fetch = () => {
            outbound++;
            return Promise.reject(
              new Error("External delivery forbidden in this test"),
            );
          };
          try {
            await db
              .update(monitoringAgents)
              .set({ desiredState: "enabled" })
              .where(eq(monitoringAgents.serverId, serverId));
            for (const mode of ["mute", "category", "archived"] as const) {
              const at = new Date(Date.now() + 600_000);
              const saved = await saveScoutAlertRule({
                ...scope,
                rule: {
                  ...rule,
                  name: `Suppression ${mode}`,
                  condition: { ...rule.condition, durationSeconds: 0 },
                },
              });
              await samples(at, 99, 1);
              await sweep(at);
              const [incident] = await db
                .select()
                .from(scoutAlertIncidents)
                .where(
                  and(
                    eq(scoutAlertIncidents.ruleId, saved.id),
                    isNull(scoutAlertIncidents.resolvedAt),
                  ),
                );
              assert(incident);
              const item = (await pending()).find(
                (row) =>
                  row.towbar_notification_events.payload.details.incidentId ===
                  incident.id,
              )!;
              assert(item);
              if (mode === "mute")
                await muteScoutAlerts({
                  ...scope,
                  ruleId: saved.id,
                  durationSeconds: 3600,
                  reason: "Deployment maintenance",
                });
              if (mode === "category")
                await db
                  .update(notificationDestinations)
                  .set({ categories: [] })
                  .where(eq(notificationDestinations.id, destinationId));
              if (mode === "archived")
                await db
                  .update(servers)
                  .set({ archivedAt: new Date() })
                  .where(eq(servers.id, serverId));
              const input = {
                deliveryId: item.towbar_notification_deliveries.id,
                cycle: item.towbar_notification_deliveries.cycle,
                attempt: 1,
              };
              assert.equal(
                (await executeNotificationDeliveryAttempt(input)).outcome,
                "terminal",
              );
              const [delivery] = await db
                .select()
                .from(notificationDeliveries)
                .where(eq(notificationDeliveries.id, input.deliveryId));
              assert.equal(
                delivery?.lastErrorCode,
                "SCOUT_NOTIFICATION_SUPPRESSED",
              );
              await db
                .update(servers)
                .set({ archivedAt: null })
                .where(eq(servers.id, serverId));
              await db
                .update(notificationDestinations)
                .set({ categories: ["scout"] })
                .where(eq(notificationDestinations.id, destinationId));
              if (mode === "mute")
                await muteScoutAlerts({
                  ...scope,
                  ruleId: saved.id,
                  durationSeconds: 0,
                  reason: "",
                });
              assert.equal(
                (await executeNotificationDeliveryAttempt(input)).outcome,
                "terminal",
                "A delayed retry must not revive a suppressed delivery",
              );
              await deleteScoutAlertRule({ ...scope, ruleId: saved.id });
            }
            assert.equal(outbound, 0);
          } finally {
            globalThis.fetch = originalFetch;
          }
        },
      );
      await t.test(
        "restart windows exclude the left boundary and do not recover across blackouts",
        async () => {
          const saved = await saveScoutAlertRule({
            ...scope,
            rule: scoutAlertRuleSchema.parse({
              name: "Restart loop",
              condition: {
                ...scoutAlertPresets.find((p) => p.id === "restarts")!
                  .condition,
                windowSeconds: 60,
                recoverySeconds: 0,
              },
            }),
          });
          const at = new Date(Date.now() + 1200_000);
          const entityId = "a".repeat(64);
          const add = (offset: number, restartCount: number | null) =>
            db.insert(monitoringSamples).values({
              serverId,
              entityId,
              bucketAt: new Date(at.getTime() + offset),
              metrics:
                restartCount === null
                  ? {}
                  : aggregateMonitoringValues({ restartCount }),
            });
          await add(-90_000, 0);
          await add(-60_000, 9);
          await add(-30_000, 10);
          await add(0, 11);
          await sweep(at);
          let [state] = await db
            .select()
            .from(scoutAlertRules)
            .where(eq(scoutAlertRules.id, saved.id));
          assert.equal(
            state?.observedValue,
            2,
            "Exclude nine restarts at the exact left boundary",
          );
          assert.equal(state?.evaluationState, "healthy");
          await add(30_000, 15);
          await sweep(new Date(at.getTime() + 30_000));
          [state] = await db
            .select()
            .from(scoutAlertRules)
            .where(eq(scoutAlertRules.id, saved.id));
          assert.equal(state?.evaluationState, "firing");
          await add(300_000, 15);
          await sweep(new Date(at.getTime() + 300_000));
          [state] = await db
            .select()
            .from(scoutAlertRules)
            .where(eq(scoutAlertRules.id, saved.id));
          assert.equal(state?.evaluationState, "unknown");
          assert.equal(
            (
              await db
                .select()
                .from(scoutAlertIncidents)
                .where(
                  and(
                    eq(scoutAlertIncidents.ruleId, saved.id),
                    isNull(scoutAlertIncidents.resolvedAt),
                  ),
                )
            ).length,
            1,
          );
          await deleteScoutAlertRule({ ...scope, ruleId: saved.id });
        },
      );
      await t.test(
        "retention preserves active delivery proof and removes expired resolved history",
        async () => {
          const { maintainScoutAlertHistory } =
            await import("./alert-retention.js");
          const saved = await saveScoutAlertRule({ ...scope, rule });
          const at = new Date(Date.now() + 1800_000);
          await samples(at, 99);
          await sweep(at);
          const [incident] = await db
            .select()
            .from(scoutAlertIncidents)
            .where(
              and(
                eq(scoutAlertIncidents.ruleId, saved.id),
                isNull(scoutAlertIncidents.resolvedAt),
              ),
            );
          assert(incident);
          const item = (await pending()).find(
            (row) =>
              row.towbar_notification_events.payload.details.incidentId ===
              incident.id,
          )!;
          const old = new Date(at.getTime() - 16 * 86400_000);
          await db
            .update(notificationEvents)
            .set({ occurredAt: old })
            .where(
              eq(notificationEvents.id, item.towbar_notification_events.id),
            );
          await maintainScoutAlertHistory(at);
          assert.equal(
            (
              await db
                .select()
                .from(notificationEvents)
                .where(
                  eq(notificationEvents.id, item.towbar_notification_events.id),
                )
            ).length,
            1,
          );
          await db
            .update(scoutAlertIncidents)
            .set({ resolvedAt: old, resolutionReason: "recovered" })
            .where(eq(scoutAlertIncidents.id, incident.id));
          await maintainScoutAlertHistory(at);
          assert.equal(
            (
              await db
                .select()
                .from(notificationEvents)
                .where(
                  eq(notificationEvents.id, item.towbar_notification_events.id),
                )
            ).length,
            0,
          );
          assert.equal(
            (
              await db
                .select()
                .from(scoutAlertIncidents)
                .where(eq(scoutAlertIncidents.id, incident.id))
            ).length,
            0,
          );
          await deleteScoutAlertRule({ ...scope, ruleId: saved.id });
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
