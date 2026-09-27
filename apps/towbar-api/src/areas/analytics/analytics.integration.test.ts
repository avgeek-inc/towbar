import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import {
  analyticsCellSchema,
  monitoringSampleSchema,
  normalizeDeploymentManifest,
  normalizeServerConfiguration,
} from "@workspace/towbar-core";
import {
  analyticsSamples,
  apps,
  integrationInstallations,
  monitoringAgents,
  servers,
  sources,
  workspaces,
} from "@workspace/towbar-database/schema";
import { testInstanceLinks } from "../sources/instance-test-helper.js";
const databaseUrl = process.env.TOWBAR_TEST_DATABASE_URL;
void test(
  "analytics ingestion, reports, isolation, replay and retention",
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
    const { getAnalyticsReport, maintainAnalytics, getAnalyticsConfiguration } =
      await import("./service.js");
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
      const cell = analyticsCellSchema.parse({
        appId,
        kind: "request",
        path: "/docs",
        referrer: "",
        method: "GET",
        status: 503,
        country: "",
        browser: "",
        device: "",
        visitor: "",
        session: "",
        count: 2,
        bytes: 100,
        durationMs: 20,
        histogram: [2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      });
      const body = monitoringSampleSchema.parse({
        id: randomBytes(16).toString("hex"),
        collectedAt: new Date(Date.now() - 1000).toISOString(),
        version: "1.1.0",
        collectionDurationMs: 5,
        collectionErrors: 0,
        droppedSamples: 0,
        entities: [{ id: "host", metrics: { cpuPercent: 10 } }],
        analytics: [
          cell,
          { ...cell, appId: randomUUID() },
          { ...cell, path: "/private/account" },
        ],
      });
      const result = await Promise.all([
        ingestMonitoringSample(serverId, generation, body),
        ingestMonitoringSample(serverId, generation, body),
      ]);
      assert.equal(result.filter((r) => r.replayed).length, 1);
      const rows = await db
        .select()
        .from(analyticsSamples)
        .where(eq(analyticsSamples.appId, appId));
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.cells.length, 1);
      const report = await getAnalyticsReport({
        appId,
        workspaceId,
        days: 7,
        kind: "request",
      });
      assert.equal(report.total, 2);
      assert.equal(report.errors, 2);
      assert.equal(report.meanMs, 10);
      assert.equal(report.p95Ms, 10);
      assert.equal(report.dimensions.path?.[0]?.value, "/docs");
      await assert.rejects(
        getAnalyticsReport({
          appId,
          workspaceId: randomUUID(),
          days: 7,
          kind: "request",
        }),
      );
      const page = analyticsCellSchema.parse({
        ...cell,
        kind: "pageview",
        status: 0,
        bytes: 0,
        durationMs: 0,
        histogram: Array(11).fill(0),
        visitor: "b".repeat(64),
        session: "c".repeat(64),
        country: "IN",
        browser: "Safari",
        device: "Desktop",
      });
      await ingestMonitoringSample(serverId, generation, {
        ...body,
        id: randomBytes(16).toString("hex"),
        analytics: [page],
      });
      const visits = await getAnalyticsReport({
        appId,
        workspaceId,
        days: 7,
        kind: "pageview",
      });
      assert.equal(visits.total, 2);
      assert.equal(visits.visitors, 1);
      assert.equal(visits.sessions, 1);
      await db
        .update(apps)
        .set({
          config: {
            ...config,
            analytics: { ...config.analytics!, visitorIdentity: false },
          },
        })
        .where(eq(apps.id, appId));
      const withoutIdentity = {
        ...body,
        id: randomBytes(16).toString("hex"),
        analytics: [page],
      };
      await ingestMonitoringSample(serverId, generation, withoutIdentity);
      const [anonymous] = await db
        .select()
        .from(analyticsSamples)
        .where(eq(analyticsSamples.sampleId, withoutIdentity.id));
      assert.equal(anonymous?.cells[0]?.visitor, "");
      await db.insert(analyticsSamples).values({
        serverId,
        appId,
        sampleId: "f".repeat(32),
        collectedAt: new Date(Date.now() - 8 * 86400000),
        cells: [cell],
      });
      await maintainAnalytics();
      assert.equal(
        (
          await db
            .select()
            .from(analyticsSamples)
            .where(eq(analyticsSamples.sampleId, "f".repeat(32)))
        ).length,
        0,
      );
      assert.notEqual(
        (await getAnalyticsConfiguration(serverId)).refresh,
        "initial",
      );
      await db
        .update(apps)
        .set({ config: { ...config, analytics: undefined } })
        .where(eq(apps.id, appId));
      const disabled = { ...body, id: randomBytes(16).toString("hex") };
      await ingestMonitoringSample(serverId, generation, disabled);
      assert.equal(
        (
          await db
            .select()
            .from(analyticsSamples)
            .where(eq(analyticsSamples.sampleId, disabled.id))
        ).length,
        0,
      );
    } finally {
      await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
      await closeDatabase();
    }
  },
);
