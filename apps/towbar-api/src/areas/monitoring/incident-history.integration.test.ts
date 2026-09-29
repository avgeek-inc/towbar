import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import {
  monitoringSampleSchema,
  normalizeServerConfiguration,
  scoutAlertRuleSchema,
} from "@workspace/towbar-core";
import {
  monitoringAgents,
  monitoringSamples,
  scoutAlertIncidents,
  scoutHttpChecks,
  servers,
  workspaces,
} from "@workspace/towbar-database/schema";

const databaseUrl = process.env.TOWBAR_TEST_DATABASE_URL;
void test(
  "incident history includes the triggering bucket and keeps its reading after retention",
  { skip: !databaseUrl },
  async (t) => {
    assert(databaseUrl && new URL(databaseUrl).pathname.endsWith("_test"));
    const admin = postgres(databaseUrl, { max: 1 });
    const databaseName = `towbar_incident_${randomUUID().replaceAll("-", "")}_test`;
    await admin.unsafe(`create database ${databaseName}`);
    const isolated = new URL(databaseUrl);
    isolated.pathname = `/${databaseName}`;
    process.env.DATABASE_TOWBAR_URL = isolated.href;
    process.env.TOWBAR_CREDENTIALS_KEY = randomBytes(32).toString("base64");
    process.env.TOWBAR_INTERNAL_HMAC_SECRET = randomBytes(32).toString("hex");
    const { runTowbarMigrations } =
      await import("@workspace/towbar-database/migrate");
    await runTowbarMigrations({
      databaseUrl: isolated.href,
      logger: { info() {}, error() {} },
    });
    const { getTowbarDatabase, closeDatabase } =
      await import("../../infrastructure/database.js");
    const { ingestMonitoringSample } = await import("./ingest.js");
    const { saveScoutAlertRule } = await import("./alert-rules.js");
    const { evaluateScoutAlerts } = await import("./alert-evaluator.js");
    const { getScoutIncident } = await import("./incident-history.js");
    const db = getTowbarDatabase();
    const workspaceId = randomUUID(),
      serverId = randomUUID(),
      generation = randomUUID();
    const scope = { workspaceId, serverId };
    const openedAt = new Date("2026-09-30T12:00:20Z");
    const bucketAt = "2026-09-30T12:00:00.000Z";
    try {
      await db.insert(workspaces).values({
        id: workspaceId,
        slug: workspaceId,
        name: "Incident history test",
      });
      await db.insert(servers).values({
        id: serverId,
        workspaceId,
        canonicalIp: "192.0.2.210",
        config: normalizeServerConfiguration({
          ip: "192.0.2.210",
          ssh: { username: "deploy" },
        }),
        configDigest: "test",
      });
      await db.insert(monitoringAgents).values({
        serverId,
        generation,
        desiredState: "enabled",
        status: "online",
        tokenHash: "a".repeat(64),
        retentionDays: 15,
      });
      const rule = await saveScoutAlertRule({
        ...scope,
        requestedBy: null,
        rule: scoutAlertRuleSchema.parse({
          name: "CPU alert",
          condition: { metric: "cpuPercent", threshold: 85 },
        }),
      });
      await ingestMonitoringSample(
        serverId,
        generation,
        monitoringSampleSchema.parse({
          id: randomBytes(16).toString("hex"),
          collectedAt: openedAt.toISOString(),
          version: "1.1.0",
          collectionDurationMs: 5,
          collectionErrors: 0,
          droppedSamples: 0,
          entities: [{ id: "host", metrics: { cpuPercent: 95 } }],
        }),
        openedAt,
      );
      assert.equal(
        (await evaluateScoutAlerts(openedAt, async () => {})).errors,
        0,
      );
      const [incident] = await db
        .select()
        .from(scoutAlertIncidents)
        .where(eq(scoutAlertIncidents.ruleId, rule!.id));
      assert(incident);
      assert.deepEqual(incident.triggerObservation, {
        at: bucketAt,
        value: 95,
      });
      const input = { ...scope, incidentId: incident.id };
      await t.test("a new incident includes its only measurement", async () => {
        const details = await getScoutIncident(input, openedAt);
        assert.equal(details.history.startAt, bucketAt);
        assert.deepEqual(
          details.history.points.filter((point) => point.value !== null),
          [{ at: bucketAt, value: 95 }],
        );
      });
      await t.test(
        "existing incidents use their original measurements",
        async () => {
          await db
            .update(scoutAlertIncidents)
            .set({ triggerObservation: null })
            .where(eq(scoutAlertIncidents.id, incident.id));
          const details = await getScoutIncident(input, openedAt);
          assert.equal(details.history.points[0]?.value, 95);
          await db
            .update(scoutAlertIncidents)
            .set({ triggerObservation: incident.triggerObservation })
            .where(eq(scoutAlertIncidents.id, incident.id));
        },
      );
      await t.test(
        "missing reports do not overwrite the triggering reading",
        async () => {
          const later = new Date(openedAt.getTime() + 5 * 60_000);
          await evaluateScoutAlerts(later, async () => {});
          const details = await getScoutIncident(input, later);
          assert.equal(details.incident.lastValue, null);
          assert.deepEqual(
            details.incident.triggerObservation,
            incident.triggerObservation,
          );
        },
      );
      await t.test(
        "recovered history ends five minutes after recovery",
        async () => {
          const resolvedAt = new Date(openedAt.getTime() + 60_000);
          const endAt = new Date(resolvedAt.getTime() + 5 * 60_000);
          for (const [at, value] of [
            [resolvedAt, 20],
            [endAt, 30],
            [new Date(endAt.getTime() + 60_000), 99],
          ] as const) {
            await ingestMonitoringSample(
              serverId,
              generation,
              monitoringSampleSchema.parse({
                id: randomBytes(16).toString("hex"),
                collectedAt: at.toISOString(),
                version: "1.1.0",
                collectionDurationMs: 5,
                collectionErrors: 0,
                droppedSamples: 0,
                entities: [{ id: "host", metrics: { cpuPercent: value } }],
              }),
              at,
            );
          }
          await db
            .update(scoutAlertIncidents)
            .set({ resolvedAt, resolutionReason: "recovered" })
            .where(eq(scoutAlertIncidents.id, incident.id));
          try {
            const details = await getScoutIncident(
              input,
              new Date(openedAt.getTime() + 60 * 60_000),
            );
            assert.equal(details.history.endAt, endAt.toISOString());
            assert.deepEqual(
              details.history.points
                .filter((point) => point.value !== null)
                .map((point) => point.value),
              [95, 20, 30],
            );
            assert(
              details.history.points.every(
                (point) => Date.parse(point.at) <= endAt.getTime(),
              ),
            );
            const recent = new Date(resolvedAt.getTime() + 2 * 60_000);
            assert.equal(
              (await getScoutIncident(input, recent)).history.endAt,
              recent.toISOString(),
            );
          } finally {
            await db
              .update(scoutAlertIncidents)
              .set({ resolvedAt: null, resolutionReason: null })
              .where(eq(scoutAlertIncidents.id, incident.id));
          }
        },
      );
      await t.test(
        "history cleanup keeps a real point at its original timestamp",
        async () => {
          await db
            .delete(monitoringSamples)
            .where(eq(monitoringSamples.serverId, serverId));
          const later = new Date(openedAt.getTime() + 16 * 86400_000);
          const details = await getScoutIncident(input, later);
          assert.equal(details.history.startAt, bucketAt);
          assert.deepEqual(
            details.history.points.filter((point) => point.value !== null),
            [{ at: bucketAt, value: 95 }],
          );
          assert(details.history.points.length <= 362);
          const resolvedAt = new Date(openedAt.getTime() + 60_000);
          await db
            .update(scoutAlertIncidents)
            .set({ resolvedAt, resolutionReason: "recovered" })
            .where(eq(scoutAlertIncidents.id, incident.id));
          const recovered = await getScoutIncident(input, later);
          assert.equal(
            recovered.history.endAt,
            new Date(resolvedAt.getTime() + 5 * 60_000).toISOString(),
          );
          assert.deepEqual(
            recovered.history.points.filter((point) => point.value !== null),
            [{ at: bucketAt, value: 95 }],
          );
        },
      );
      await t.test(
        "HTTP charts include checks that started before the first reading",
        async () => {
          const httpRule = await saveScoutAlertRule({
            ...scope,
            requestedBy: null,
            rule: scoutAlertRuleSchema.parse({
              name: "HTTP alert",
              condition: {
                metric: "httpAvailability",
                threshold: 1,
                http: { url: "https://example.com/health" },
              },
            }),
          });
          const checkedAt = new Date("2026-09-30T12:00:05Z");
          await db.insert(scoutHttpChecks).values({
            ruleId: httpRule!.id,
            ruleRevision: httpRule!.updatedAt,
            scheduledAt: new Date("2026-09-30T11:59:59Z"),
            checkedAt,
            state: "failed",
          });
          assert.equal(
            (await evaluateScoutAlerts(openedAt, async () => {})).errors,
            0,
          );
          const [httpIncident] = await db
            .select()
            .from(scoutAlertIncidents)
            .where(eq(scoutAlertIncidents.ruleId, httpRule!.id));
          assert(httpIncident);
          await db
            .update(scoutAlertIncidents)
            .set({ triggerObservation: null })
            .where(eq(scoutAlertIncidents.id, httpIncident.id));
          const details = await getScoutIncident(
            { ...scope, incidentId: httpIncident.id },
            openedAt,
          );
          assert.equal(details.history.points[0]?.value, 1);
        },
      );
      await assert.rejects(
        getScoutIncident({ ...input, workspaceId: randomUUID() }, openedAt),
      );
    } finally {
      await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
      await closeDatabase();
      await admin.unsafe(`drop database ${databaseName}`);
      await admin.end();
    }
  },
);
