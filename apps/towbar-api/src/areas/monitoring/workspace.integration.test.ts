import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import {
  normalizeDeploymentManifest,
  normalizeServerConfiguration,
  scoutAlertRuleSchema,
} from "@workspace/towbar-core";
import {
  apps,
  integrationInstallations,
  scoutAlertIncidents,
  scoutAlertRules,
  servers,
  sourceEnvironments,
  sources,
  workspaces,
} from "@workspace/towbar-database/schema";
const databaseUrl = process.env.TOWBAR_TEST_DATABASE_URL;
void test(
  "workspace incidents isolate tenants and support status, severity, identity, and cursor filters",
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
    const { listWorkspaceIncidents, monitoringOverviewQuery } =
      await import("./workspace.js");
    const db = getTowbarDatabase(),
      workspaceId = randomUUID(),
      foreignWorkspace = randomUUID(),
      serverId = randomUUID(),
      foreignServer = randomUUID();
    const now = new Date(),
      rule = scoutAlertRuleSchema.parse({
        name: "CPU",
        condition: { metric: "cpuPercent", threshold: 80 },
      });
    try {
      await db.insert(workspaces).values(
        [workspaceId, foreignWorkspace].map((id) => ({
          id,
          slug: id,
          name: "Monitoring test",
        })),
      );
      await db.insert(servers).values(
        [
          { id: serverId, workspaceId },
          { id: foreignServer, workspaceId: foreignWorkspace },
        ].map((s, i) => ({
          ...s,
          canonicalIp: `192.0.2.${240 + i}`,
          config: normalizeServerConfiguration({
            ip: `192.0.2.${240 + i}`,
            ssh: { username: "deploy" },
          }),
          configDigest: "test",
        })),
      );
      const rules = await db
        .insert(scoutAlertRules)
        .values(
          [0, 1, 2].map((i) => ({
            ...rule,
            severity: i === 0 ? ("critical" as const) : ("warning" as const),
            id: randomUUID(),
            workspaceId: i === 2 ? foreignWorkspace : workspaceId,
            serverId: i === 2 ? foreignServer : serverId,
            createdAt: now,
          })),
        )
        .returning();
      await db.insert(scoutAlertIncidents).values(
        rules.map((r, i) => ({
          ruleId: r.id,
          workspaceId: r.workspaceId,
          serverId: r.serverId,
          ruleName: r.name,
          severity: r.severity,
          condition: r.condition,
          openedAt: now,
          conditionStartedAt: now,
          resolvedAt: i === 1 ? now : null,
        })),
      );
      const { getWorkspaceMonitoringSummary } =
        await import("./workspace-summary.js");
      assert.deepEqual(await getWorkspaceMonitoringSummary(workspaceId), {
        activeIncidents: 1,
        criticalVulnerabilities: 0,
      });
      const query = monitoringOverviewQuery.parse({ limit: 1 });
      const active = await listWorkspaceIncidents(workspaceId, query);
      assert.equal(active.items.length, 1);
      assert.equal(active.items[0]!.incident.workspaceId, workspaceId);
      assert.equal(active.items[0]!.incident.severity, "critical");
      assert.equal(
        (
          await listWorkspaceIncidents(
            workspaceId,
            monitoringOverviewQuery.parse({
              state: "active",
              severity: "warning",
            }),
          )
        ).items.length,
        0,
      );
      assert.equal(
        (
          await listWorkspaceIncidents(
            workspaceId,
            monitoringOverviewQuery.parse({
              state: "resolved",
              severity: "warning",
            }),
          )
        ).items.length,
        1,
      );
      const { testInstanceLinks } =
        await import("../sources/instance-test-helper.js");
      const [installation] = await db
        .insert(integrationInstallations)
        .values({
          provider: "github",
          workspaceId,
          externalId: randomUUID(),
          principalName: "example",
          principalType: "Organization",
        })
        .returning();
      const sourceId = randomUUID();
      await db.insert(sources).values({
        id: sourceId,
        workspaceId,
        integrationInstallationId: installation!.id,
        repositoryOwner: "example",
        repositoryName: "monitoring",
      });
      const links = await testInstanceLinks(sourceId, "website");
      const [staging] = await db
        .insert(sourceEnvironments)
        .values({
          sourceId,
          name: "staging",
          branch: "develop",
        })
        .returning();
      const config = normalizeDeploymentManifest({
        version: 2,
        apps: [
          {
            id: "website",
            name: "Website",
            server: "192.0.2.240",
            dockerfile: "Dockerfile",
            container: { port: 3000 },
          },
        ],
      }).apps[0]!;
      const instances = await db
        .insert(apps)
        .values(
          [links.sourceEnvironmentId, staging!.id].map(
            (sourceEnvironmentId) => ({
              ...links,
              sourceEnvironmentId,
              workspaceId,
              sourceId,
              serverId,
              manifestId: "website",
              name: "Website",
              config,
              configDigest: "fixture",
              sourceRevision: "abcdef0",
            }),
          ),
        )
        .returning();
      await db
        .update(scoutAlertRules)
        .set({ deployableId: instances[1]!.id })
        .where(eq(scoutAlertRules.id, rules[1]!.id));
      await db
        .update(scoutAlertIncidents)
        .set({ deployableId: instances[1]!.id })
        .where(eq(scoutAlertIncidents.ruleId, rules[1]!.id));
      const result = await listWorkspaceIncidents(
        workspaceId,
        monitoringOverviewQuery.parse({ state: "resolved" }),
      );
      assert.equal(result.items.length, 1);
      assert.equal(result.items[0]!.workload?.environmentName, "staging");
      await db
        .update(servers)
        .set({ archivedAt: now })
        .where(eq(servers.id, serverId));
      assert.equal(
        (await getWorkspaceMonitoringSummary(workspaceId)).activeIncidents,
        0,
      );
      assert.equal(
        (
          await listWorkspaceIncidents(
            workspaceId,
            monitoringOverviewQuery.parse({}),
          )
        ).items.length,
        0,
      );
      assert.equal(
        monitoringOverviewQuery.safeParse({ before: now.toISOString() })
          .success,
        false,
      );
    } finally {
      for (const id of [workspaceId, foreignWorkspace])
        await db.delete(workspaces).where(eq(workspaces.id, id));
      await closeDatabase();
    }
  },
);
