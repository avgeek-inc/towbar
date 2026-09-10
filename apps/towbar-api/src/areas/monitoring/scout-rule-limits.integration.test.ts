import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import {
  aggregateMonitoringValues,
  normalizeDeploymentManifest,
  normalizeServerConfiguration,
  scoutAlertRuleSchema,
} from "@workspace/towbar-core";
import {
  apps,
  githubInstallations,
  monitoringAgents,
  monitoringSamples,
  servers,
  sources,
  users,
  workspaces,
} from "@workspace/towbar-database/schema";

const databaseUrl = process.env.TOWBAR_TEST_DATABASE_URL;
void test(
  "Scout caps each entity at ten rules even with concurrent creates and reassignment",
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
    const { saveScoutAlertRule, deleteScoutAlertRule, listScoutAlertRules } =
      await import("./alert-rules.js");
    const db = getTowbarDatabase();
    const workspaceId = randomUUID(),
      serverId = randomUUID(),
      sourceId = randomUUID(),
      userId = randomUUID();
    const appId = randomUUID(),
      resourceId = randomUUID();
    const scope = { workspaceId, serverId, requestedBy: userId };
    const rule = (deployableId: string | null, enabled = true) =>
      scoutAlertRuleSchema.parse({
        name: "Memory alert",
        deployableId,
        enabled,
        condition: { metric: "memoryPercent", threshold: 80 },
      });
    const limitError = { status: 409, code: "SCOUT_ALERT_RULE_LIMIT_REACHED" };
    try {
      await db
        .insert(workspaces)
        .values({ id: workspaceId, slug: workspaceId, name: "Rule limits" });
      await db.insert(users).values({
        id: userId,
        email: `${userId}@example.com`,
        displayName: "Tester",
      });
      await db.insert(servers).values({
        id: serverId,
        workspaceId,
        canonicalIp: "192.0.2.209",
        config: normalizeServerConfiguration({
          ip: "192.0.2.209",
          ssh: { username: "deploy" },
        }),
        configDigest: "fixture",
      });
      const [installation] = await db
        .insert(githubInstallations)
        .values({
          workspaceId,
          installationId: randomUUID(),
          accountLogin: "example",
          accountType: "Organization",
        })
        .returning();
      await db.insert(sources).values({
        id: sourceId,
        workspaceId,
        githubInstallationId: installation!.id,
        repositoryOwner: "example",
        repositoryName: "limits",
        branch: "main",
      });
      const manifest = normalizeDeploymentManifest({
        version: 2,
        resources: [
          {
            id: "database",
            name: "Database",
            type: "postgres",
            server: "192.0.2.209",
          },
        ],
        apps: [
          {
            id: "app",
            name: "App",
            server: "192.0.2.209",
            dockerfile: "Dockerfile",
            context: ".",
            container: { port: 3000 },
            health: { path: "/health" },
          },
        ],
      });
      for (const [id, kind] of [
        [appId, "app"],
        [resourceId, "postgres"],
      ] as const) {
        await db.insert(apps).values({
          id,
          kind,
          workspaceId,
          sourceId,
          serverId,
          manifestId: kind,
          name: kind,
          config: kind === "app" ? manifest.apps[0]! : manifest.resources![0]!,
          configDigest: "fixture",
          sourceRevision: "abcdef0",
        });
      }
      const { getWorkspaceMonitoringSummary } =
        await import("./workspace-summary.js");
      const summaryNow = new Date();
      await db.insert(monitoringAgents).values({
        serverId,
        desiredState: "enabled",
        status: "online",
        lastCollectedAt: summaryNow,
      });
      await db.insert(monitoringSamples).values([
        {
          serverId,
          entityId: "host",
          bucketAt: summaryNow,
          metrics: aggregateMonitoringValues({
            cpuPercent: 81,
            memoryPercent: 95,
          }),
        },
        ...["app-one", "app-two"].map((entityId) => ({
          serverId,
          entityId,
          deployableId: appId,
          state: "running",
          bucketAt: summaryNow,
          metrics: aggregateMonitoringValues({ cpuPercent: 90 }),
        })),
        {
          serverId,
          entityId: "resource",
          deployableId: resourceId,
          state: "running",
          bucketAt: summaryNow,
          metrics: aggregateMonitoringValues({ memoryPercent: 80 }),
        },
        {
          serverId,
          entityId: "stopped",
          deployableId: resourceId,
          state: "exited",
          bucketAt: summaryNow,
          metrics: aggregateMonitoringValues({ memoryPercent: 99 }),
        },
        {
          serverId,
          entityId: "stale",
          deployableId: resourceId,
          state: "running",
          bucketAt: new Date(summaryNow.getTime() - 120000),
          metrics: aggregateMonitoringValues({ memoryPercent: 99 }),
        },
        {
          serverId,
          entityId: "orphan",
          deployableId: randomUUID(),
          state: "running",
          bucketAt: summaryNow,
          metrics: aggregateMonitoringValues({ memoryPercent: 99 }),
        },
      ]);
      // No rules exist: count entities once, even across metrics and replicas. Exactly 80 is healthy.
      assert.deepEqual(
        await getWorkspaceMonitoringSummary(workspaceId, summaryNow),
        {
          activeIncidents: 0,
          criticalVulnerabilities: 0,
          pressuredEntities: 2,
        },
      );
      await db.insert(monitoringSamples).values({
        serverId,
        entityId: "resource",
        deployableId: resourceId,
        state: "running",
        bucketAt: new Date(summaryNow.getTime() + 1000),
        metrics: aggregateMonitoringValues({ memoryPercent: 81 }),
      });
      assert.equal(
        (
          await getWorkspaceMonitoringSummary(
            workspaceId,
            new Date(summaryNow.getTime() + 1000),
          )
        ).pressuredEntities,
        3,
      );
      await db
        .update(apps)
        .set({ archivedAt: summaryNow })
        .where(eq(apps.id, appId));
      assert.equal(
        (await getWorkspaceMonitoringSummary(workspaceId, summaryNow))
          .pressuredEntities,
        1,
      );
      await db.update(apps).set({ archivedAt: null }).where(eq(apps.id, appId));
      assert.equal(
        (
          await getWorkspaceMonitoringSummary(
            workspaceId,
            new Date(summaryNow.getTime() + 120000),
          )
        ).pressuredEntities,
        0,
      );
      await db
        .delete(monitoringSamples)
        .where(eq(monitoringSamples.serverId, serverId));
      for (const entity of [null, appId, resourceId]) {
        // Disabled rules also occupy slots; concurrent requests contend for the tenth.
        for (let i = 0; i < 9; i++)
          await saveScoutAlertRule({ ...scope, rule: rule(entity, false) });
        const attempts = await Promise.allSettled(
          [0, 1, 2].map(() =>
            saveScoutAlertRule({ ...scope, rule: rule(entity) }),
          ),
        );
        assert.equal(
          attempts.filter((r) => r.status === "fulfilled").length,
          1,
        );
        for (const result of attempts)
          if (result.status === "rejected") {
            assert.equal(result.reason.code, limitError.code);
            assert.equal(result.reason.status, 409);
          }
        const listed = await listScoutAlertRules({
          ...scope,
          deployableId: entity ?? "server",
        });
        assert.equal(listed.rules.length, 10);
        const first = listed.rules[0]!;
        await saveScoutAlertRule({
          ...scope,
          ruleId: first.id,
          rule: { ...rule(entity), name: "Edited at capacity" },
        });
        // Workload environments do not have separate allowances.
        await assert.rejects(
          saveScoutAlertRule({
            ...scope,
            rule: {
              ...rule(entity),
              environment: entity ? "preview" : "production",
            },
          }),
          limitError,
        );
        await deleteScoutAlertRule({ ...scope, ruleId: first.id });
        await saveScoutAlertRule({ ...scope, rule: rule(entity) });
      }
      const appRule = (
        await listScoutAlertRules({ ...scope, deployableId: appId })
      ).rules[0]!;
      await assert.rejects(
        saveScoutAlertRule({
          ...scope,
          ruleId: appRule.id,
          rule: rule(resourceId),
        }),
        limitError,
      );
      assert.equal(
        (await listScoutAlertRules({ ...scope, deployableId: appId })).rules
          .length,
        10,
      );
      const { listWorkspaceAlerts, monitoringOverviewQuery } =
        await import("./workspace.js");
      for (const [kind, id] of [
        ["server", serverId],
        ["app", appId],
        ["resource", resourceId],
      ]) {
        const result = await listWorkspaceAlerts(
          workspaceId,
          monitoringOverviewQuery.parse({ kind, limit: 50 }),
        );
        assert.equal(result.items.length, 10);
        for (const row of result.items)
          assert.equal(row.rule.deployableId ?? row.rule.serverId, id);
        const specific = await listWorkspaceAlerts(
          workspaceId,
          monitoringOverviewQuery.parse({ entityId: id, limit: 50 }),
        );
        assert.equal(specific.items.length, 10);
      }
      assert.equal(
        (
          await listWorkspaceAlerts(
            workspaceId,
            monitoringOverviewQuery.parse({ kind: "server", entityId: appId }),
          )
        ).items.length,
        0,
      );
    } finally {
      await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
      await db.delete(users).where(eq(users.id, userId));
      await closeDatabase();
    }
  },
);
