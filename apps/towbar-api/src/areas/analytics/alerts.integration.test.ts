import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import {
  analyticsCellSchema,
  monitoringSampleSchema,
  normalizeDeploymentManifest,
  normalizeServerConfiguration,
  scoutAlertRuleSchema,
} from "@workspace/towbar-core";
import {
  analyticsSamples,
  apps,
  integrationInstallations,
  monitoringAgents,
  scoutAlertIncidents,
  scoutAlertRules,
  servers,
  sources,
  workspaces,
} from "@workspace/towbar-database/schema";
import { testInstanceLinks } from "../sources/instance-test-helper.js";
const databaseUrl = process.env.TOWBAR_TEST_DATABASE_URL;
void test(
  "traffic alert eligibility, rolling counts, incidents, unknown data and recovery",
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
    const { ingestMonitoringSample } = await import("../monitoring/ingest.js");
    const { saveScoutAlertRule, listScoutAlertRules } =
      await import("../monitoring/alert-rules.js");
    const { evaluateScoutAlerts } =
      await import("../monitoring/alert-evaluator.js");
    const { getScoutIncident } =
      await import("../monitoring/incident-history.js");
    const db = getTowbarDatabase(),
      workspaceId = randomUUID(),
      serverId = randomUUID(),
      generation = randomUUID(),
      appId = randomUUID(),
      sourceId = randomUUID();
    const config = normalizeDeploymentManifest({
      version: 2,
      apps: [
        {
          id: "web",
          name: "Web",
          server: "192.0.2.200",
          dockerfile: "Dockerfile",
          container: { port: 3000 },
          domains: { primary: "example.com" },
          analytics: {
            enabled: true,
            pageviews: true,
            visitorIdentity: true,
            retentionDays: 7,
            excludePaths: ["/private"],
          },
        },
      ],
    }).apps[0]!;
    try {
      await db
        .insert(workspaces)
        .values({ id: workspaceId, slug: workspaceId, name: "Analytics test" });
      await db.insert(servers).values({
        id: serverId,
        workspaceId,
        canonicalIp: "192.0.2.200",
        config: normalizeServerConfiguration({
          ip: "192.0.2.200",
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
      });
      const [installation] = await db
        .insert(integrationInstallations)
        .values({
          provider: "github",
          workspaceId,
          externalId: randomUUID(),
          principalName: "test",
          principalType: "Organization",
        })
        .returning();
      await db.insert(sources).values({
        id: sourceId,
        workspaceId,
        integrationInstallationId: installation!.id,
        repositoryOwner: "test",
        repositoryName: "analytics",
      });
      await db.insert(apps).values({
        ...(await testInstanceLinks(sourceId, "web")),
        id: appId,
        workspaceId,
        sourceId,
        serverId,
        manifestId: "web",
        name: "Web",
        config,
        configDigest: "test",
        sourceRevision: "abcdef0",
      });
      const now = new Date(
        Math.floor((Date.now() - 900_000) / 30_000) * 30_000,
      );
      const scope = { serverId, workspaceId, requestedBy: null };
      const rule = (metric: string, operator = "above", threshold = 5) =>
        scoutAlertRuleSchema.parse({
          name: metric,
          deployableId: appId,
          condition: { metric, operator, threshold, windowSeconds: 60 },
        });
      const listed = await listScoutAlertRules(scope);
      assert.deepEqual(listed.workloads[0]?.analytics, {
        httpRequests: true,
        pageviews: true,
      });
      const requestRule = await saveScoutAlertRule({
        ...scope,
        rule: rule("httpRequests"),
      });
      const pageviewRule = await saveScoutAlertRule({
        ...scope,
        rule: rule("pageviews", "below", 0),
      });
      await assert.rejects(
        saveScoutAlertRule({
          ...scope,
          workspaceId: randomUUID(),
          rule: rule("httpRequests"),
        }),
        { status: 404 },
      );
      const cell = analyticsCellSchema.parse({
        appId,
        kind: "request",
        path: "/docs",
        referrer: "",
        method: "GET",
        status: 200,
        country: "",
        browser: "",
        device: "",
        visitor: "",
        session: "",
        count: 3,
        bytes: 30,
        durationMs: 3,
        histogram: [3, 0, 0, 0, 0, 0, 0, 0],
      });
      async function ingest(
        second: number,
        requestCount: number,
        pageviews = 0,
        ready = true,
        dropped = 0,
      ) {
        const sample = monitoringSampleSchema.parse({
          id: randomBytes(16).toString("hex"),
          collectedAt: new Date(now.getTime() + second * 1000).toISOString(),
          version: "1.1.0",
          collectionDurationMs: 5,
          collectionErrors: 0,
          droppedSamples: 0,
          entities: [{ id: "host", metrics: { cpuPercent: 10 } }],
          analyticsListenerReady: ready,
          analyticsServices: ready ? [{ appId, pageviews: true }] : [],
          analyticsDropped: dropped,
          analytics: [
            ...(requestCount
              ? [
                  {
                    ...cell,
                    count: requestCount,
                    histogram: [requestCount, 0, 0, 0, 0, 0, 0, 0],
                  },
                ]
              : []),
            ...(pageviews
              ? [
                  {
                    ...cell,
                    kind: "pageview",
                    count: pageviews,
                    method: "GET",
                    status: 0,
                    bytes: 0,
                    durationMs: 0,
                    histogram: [0, 0, 0, 0, 0, 0, 0, 0],
                  },
                ]
              : []),
            {
              ...cell,
              path: "/private/secret",
              count: 1000,
              histogram: [1000, 0, 0, 0, 0, 0, 0, 0],
            },
          ],
        });
        await ingestMonitoringSample(serverId, generation, sample);
        await ingestMonitoringSample(serverId, generation, sample);
      }
      async function evaluate(second: number) {
        const result = await evaluateScoutAlerts(
          new Date(now.getTime() + second * 1000),
          async () => {},
        );
        assert.equal(result.errors, 0);
        return db
          .select()
          .from(scoutAlertRules)
          .where(eq(scoutAlertRules.serverId, serverId));
      }
      const incidents = () =>
        db
          .select()
          .from(scoutAlertIncidents)
          .where(eq(scoutAlertIncidents.serverId, serverId));
      await ingest(0, 100); // Baseline must not contribute to the next minute's count.
      await ingest(30, 3);
      let evaluated = await evaluate(30);
      assert(evaluated.every((r) => r.evaluationState === "unknown"));
      await ingest(60, 3);
      evaluated = await evaluate(60);
      assert.equal(
        evaluated.find((r) => r.id === requestRule.id)?.observedValue,
        6,
      );
      assert.equal(
        evaluated.find((r) => r.id === pageviewRule.id)?.observedValue,
        0,
      );
      assert(evaluated.every((r) => r.evaluationState === "firing"));
      assert.equal((await incidents()).length, 2);
      await ingest(90, 3);
      await evaluate(90);
      assert.equal(
        (await incidents()).length,
        2,
        "continuing breaches do not duplicate incidents",
      );
      const active = (await incidents()).find(
        (i) => i.ruleId === requestRule.id,
      )!;
      const history = await getScoutIncident(
        { ...scope, incidentId: active.id },
        new Date(now.getTime() + 90_000),
      );
      assert(history.history.points.some((p) => p.value === 6));
      await ingest(120, 0, 0, false);
      evaluated = await evaluate(120);
      assert(evaluated.every((r) => r.evaluationState === "unknown"));
      assert(
        (await incidents()).every((i) => !i.resolvedAt),
        "missing data cannot recover incidents",
      );
      await ingest(150, 0, 1);
      await ingest(180, 0, 1);
      await ingest(210, 0, 1);
      evaluated = await evaluate(210);
      assert(evaluated.every((r) => r.evaluationState === "healthy"));
      assert(
        (await incidents()).every((i) => i.resolutionReason === "recovered"),
      );
      await ingest(240, 100, 0, true, 1);
      evaluated = await evaluate(240);
      assert(
        evaluated.every((r) => r.evaluationState === "unknown"),
        "dropped events invalidate the counting window",
      );
      await evaluate(360);
      assert.equal(
        (await incidents()).length,
        2,
        "stale data cannot open incidents",
      );
      for (const second of [390, 420, 450])
        await ingest(second, 100, 0, true, 1);
      await evaluate(450);
      assert.equal((await incidents()).filter((i) => !i.resolvedAt).length, 2);
      await db
        .update(apps)
        .set({
          config: {
            ...config,
            analytics: { ...config.analytics!, pageviews: false },
          },
        })
        .where(eq(apps.id, appId));
      await assert.rejects(
        saveScoutAlertRule({ ...scope, rule: rule("pageviews") }),
        { status: 400 },
      );
      assert.equal(
        (await evaluate(480)).find((r) => r.id === pageviewRule.id)
          ?.evaluationState,
        "inactive",
      );
      await db
        .update(apps)
        .set({ config: { ...config, analytics: undefined } })
        .where(eq(apps.id, appId));
      await assert.rejects(
        saveScoutAlertRule({ ...scope, rule: rule("httpRequests") }),
        { status: 400 },
      );
      assert.equal(
        (await evaluate(510)).find((r) => r.id === requestRule.id)
          ?.evaluationState,
        "inactive",
      );
      assert.equal(
        (await incidents()).filter(
          (i) => i.resolutionReason === "analytics_disabled",
        ).length,
        2,
      );
      const resourceConfig = normalizeDeploymentManifest({
        version: 2,
        resources: [
          {
            id: "db",
            name: "Database",
            type: "postgres",
            server: "192.0.2.200",
          },
        ],
      }).resources![0]!;
      await db
        .update(apps)
        .set({ config: resourceConfig, kind: "postgres" })
        .where(eq(apps.id, appId));
      await assert.rejects(
        saveScoutAlertRule({ ...scope, rule: rule("httpRequests") }),
        { status: 400 },
      );
      await assert.rejects(
        saveScoutAlertRule({
          ...scope,
          rule: { ...rule("httpRequests"), deployableId: randomUUID() },
        }),
        { status: 400 },
      );
      await saveScoutAlertRule({
        ...scope,
        ruleId: requestRule.id,
        rule: { ...rule("httpRequests"), enabled: false },
      });
      const rows = await db
        .select()
        .from(analyticsSamples)
        .where(eq(analyticsSamples.appId, appId));
      assert.equal(rows.length, 12, "sample replays do not duplicate counters");
    } finally {
      await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
      await closeDatabase();
    }
  },
);
