import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import {
  aggregateMonitoringValues,
  normalizeServerConfiguration,
  scoutAlertRuleSchema,
} from "@workspace/towbar-core";
import {
  monitoringAgents,
  monitoringSamples,
  scoutAlertIncidents,
  scoutAlertRules,
  scoutHttpChecks,
  servers,
  workspaces,
} from "@workspace/towbar-database/schema";

const databaseUrl = process.env.TOWBAR_TEST_DATABASE_URL;
void test(
  "incident history retains scope, original conditions and bounded measurements",
  { skip: !databaseUrl },
  async (t) => {
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
    const { getScoutIncident } = await import("./incident-history.js");
    const db = getTowbarDatabase(),
      workspaceId = randomUUID(),
      serverId = randomUUID(),
      ruleId = randomUUID(),
      incidentId = randomUUID(),
      deployableId = randomUUID();
    const now = new Date("2026-09-06T15:00:00Z"),
      start = new Date(now.getTime() - 300_000);
    const rule = scoutAlertRuleSchema.parse({
      name: "Disk pressure",
      condition: { metric: "diskPercent", threshold: 90 },
    });
    const input = { workspaceId, serverId, incidentId };
    try {
      await db
        .insert(workspaces)
        .values({ id: workspaceId, slug: workspaceId, name: "Incident tests" });
      await db.insert(servers).values({
        id: serverId,
        workspaceId,
        canonicalIp: "192.0.2.220",
        config: normalizeServerConfiguration({
          ip: "192.0.2.220",
          ssh: { username: "deploy" },
        }),
        configDigest: "fixture",
      });
      await db.insert(monitoringAgents).values({
        serverId,
        retentionDays: 15,
        desiredState: "enabled",
        status: "online",
      });
      await db.insert(scoutAlertRules).values({
        ...rule,
        id: ruleId,
        workspaceId,
        serverId,
        updatedAt: start,
      });
      await db.insert(scoutAlertIncidents).values({
        id: incidentId,
        ruleId,
        workspaceId,
        serverId,
        ruleName: rule.name,
        severity: rule.severity,
        condition: rule.condition,
        environment: "production",
        ruleRevision: start,
        openedAt: start,
        conditionStartedAt: start,
        lastValue: 95,
      });
      await db.insert(monitoringSamples).values([
        {
          serverId,
          entityId: "host",
          bucketAt: new Date(start.getTime() - 30_000),
          metrics: aggregateMonitoringValues({ diskPercent: 99 }),
        },
        {
          serverId,
          entityId: "host",
          bucketAt: start,
          metrics: aggregateMonitoringValues({ diskPercent: 95 }),
        },
        {
          serverId,
          entityId: "host",
          bucketAt: now,
          metrics: aggregateMonitoringValues({ diskPercent: 40 }),
        },
        {
          serverId,
          entityId: "host",
          bucketAt: new Date(now.getTime() + 30_000),
          metrics: aggregateMonitoringValues({ diskPercent: 100 }),
        },
        {
          serverId,
          entityId: "workload",
          deployableId,
          bucketAt: start,
          metrics: aggregateMonitoringValues({ diskPercent: 88 }),
        },
        {
          serverId,
          entityId: "preview",
          deployableId,
          previewId: randomUUID(),
          bucketAt: start,
          metrics: aggregateMonitoringValues({ diskPercent: 20 }),
        },
      ]);
      await t.test(
        "exact incident start through now, explicit gaps, and tenant/server isolation",
        async () => {
          const result = await getScoutIncident(input, now);
          assert.equal(result.history.startAt, start.toISOString());
          assert.equal(result.history.endAt, now.toISOString());
          assert.equal(result.history.points[0]?.value, 95);
          assert.equal(result.history.points.at(-1)?.value, 40);
          assert.equal(result.history.points[1]?.value, null);
          await assert.rejects(
            getScoutIncident({ ...input, workspaceId: randomUUID() }, now),
          );
          await assert.rejects(
            getScoutIncident({ ...input, serverId: randomUUID() }, now),
          );
          await assert.rejects(
            getScoutIncident({ ...input, incidentId: randomUUID() }, now),
          );
          await assert.rejects(
            getScoutIncident({ ...input, incidentId: "invalid" }, now),
          );
        },
      );
      await t.test(
        "resolved incidents continue to now and use captured workload environment even after rule edits",
        async () => {
          await db
            .update(scoutAlertIncidents)
            .set({
              deployableId,
              resolvedAt: new Date(start.getTime() + 30_000),
              resolutionReason: "recovered",
            })
            .where(eq(scoutAlertIncidents.id, incidentId));
          await db
            .update(scoutAlertRules)
            .set({
              environment: "preview",
              deletedAt: now,
              condition: { ...rule.condition, threshold: 10 },
            })
            .where(eq(scoutAlertRules.id, ruleId));
          const result = await getScoutIncident(input, now);
          assert.equal(result.history.points[0]?.value, 88);
          assert.equal(result.incident.condition.threshold, 90);
          assert.equal(result.history.endAt, now.toISOString());
          assert.equal(result.entity.name, "Removed workload");
          await db
            .update(scoutAlertIncidents)
            .set({ environment: null })
            .where(eq(scoutAlertIncidents.id, incidentId));
          const unknown = await getScoutIncident(input, now);
          assert(unknown.history.points.every((p) => p.value === null));
          assert(unknown.history.notes.some((n) => n.includes("environment")));
          await db
            .update(scoutAlertIncidents)
            .set({ deployableId: null, environment: "production" })
            .where(eq(scoutAlertIncidents.id, incidentId));
        },
      );
      await t.test(
        "long incidents are bounded by retention and response size",
        async () => {
          await db
            .update(scoutAlertIncidents)
            .set({ openedAt: new Date(now.getTime() - 70 * 86400_000) })
            .where(eq(scoutAlertIncidents.id, incidentId));
          const result = await getScoutIncident(input, now);
          assert.equal(
            result.history.startAt,
            new Date(now.getTime() - 15 * 86400_000).toISOString(),
          );
          assert(result.history.points.length <= 361);
          assert(result.history.notes.length);
          await db
            .update(scoutAlertIncidents)
            .set({ openedAt: start })
            .where(eq(scoutAlertIncidents.id, incidentId));
        },
      );
      await t.test(
        "HTTP chart excludes checks from a changed endpoint and future checks",
        async () => {
          const condition = scoutAlertRuleSchema.parse({
            name: "HTTP",
            condition: {
              metric: "httpAvailability",
              threshold: 1,
              http: {
                url: "https://example.com",
                intervalSeconds: 60,
                timeoutSeconds: 10,
              },
            },
          }).condition;
          await db
            .update(scoutAlertIncidents)
            .set({ condition })
            .where(eq(scoutAlertIncidents.id, incidentId));
          await db.insert(scoutHttpChecks).values([
            {
              ruleId,
              scheduledAt: start,
              checkedAt: start,
              ruleRevision: start,
              state: "failed",
            },
            {
              ruleId,
              scheduledAt: new Date(start.getTime() + 60_000),
              checkedAt: new Date(start.getTime() + 60_000),
              ruleRevision: now,
              state: "healthy",
            },
          ]);
          const result = await getScoutIncident(input, now);
          assert.equal(result.history.points[0]?.value, 1);
          assert.equal(result.history.points[2]?.value, null);
        },
      );
      await t.test(
        "report age uses retained host reports, not workload reports",
        async () => {
          await db
            .update(scoutAlertIncidents)
            .set({
              condition: {
                ...rule.condition,
                metric: "missingReports",
                threshold: 180,
              },
            })
            .where(eq(scoutAlertIncidents.id, incidentId));
          const result = await getScoutIncident(input, now);
          assert.equal(result.history.points[1]?.value, 30);
          assert.equal(result.history.points.at(-1)?.value, 0);
        },
      );
      await t.test(
        "restart charts use window deltas, not lifetime counters",
        async () => {
          const restartWorkload = randomUUID();
          await db
            .update(scoutAlertIncidents)
            .set({
              deployableId: restartWorkload,
              condition: {
                ...rule.condition,
                metric: "restarts",
                threshold: 3,
                windowSeconds: 60,
              },
            })
            .where(eq(scoutAlertIncidents.id, incidentId));
          await db.insert(monitoringSamples).values(
            Array.from({ length: 5 }, (_, i) => ({
              serverId,
              entityId: "restarting",
              deployableId: restartWorkload,
              bucketAt: new Date(start.getTime() - 90_000 + i * 30_000),
              metrics: aggregateMonitoringValues({ restartCount: 10 + i }),
            })),
          );
          const result = await getScoutIncident(input, now);
          assert.equal(result.history.points[1]?.value, 2);
        },
      );
    } finally {
      await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
      await closeDatabase();
    }
  },
);
