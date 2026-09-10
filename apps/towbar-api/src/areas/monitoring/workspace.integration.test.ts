import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import {
  normalizeServerConfiguration,
  scoutAlertRuleSchema,
} from "@workspace/towbar-core";
import {
  scoutAlertIncidents,
  scoutAlertRules,
  servers,
  workspaces,
} from "@workspace/towbar-database/schema";
const databaseUrl = process.env.TOWBAR_TEST_DATABASE_URL;
void test(
  "workspace monitoring isolates tenants and paginates equal-time rules and incidents",
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
    const {
      listWorkspaceAlerts,
      listWorkspaceIncidents,
      listMonitoringEntities,
      monitoringOverviewQuery,
      monitoringEntitiesQuery,
    } = await import("./workspace.js");
    const listWorkspaceScout = (
      id: string,
      input: Parameters<typeof listWorkspaceAlerts>[1],
      incidents: boolean,
    ) =>
      incidents
        ? listWorkspaceIncidents(id, input)
        : listWorkspaceAlerts(id, input);
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
          slug: `server-${s.id}`,
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
        pressuredEntities: 0,
      });
      const query = monitoringOverviewQuery.parse({ limit: 1 });
      for (const incidents of [false, true]) {
        const first = await listWorkspaceScout(workspaceId, query, incidents);
        assert.equal(first.items.length, 1);
        assert(first.nextBefore && first.nextBeforeId);
        const second = await listWorkspaceScout(
          workspaceId,
          { ...query, before: first.nextBefore, beforeId: first.nextBeforeId },
          incidents,
        );
        assert.equal(second.items.length, 1);
        assert.equal(second.nextBefore, null);
        assert.notDeepEqual(first.items, second.items);
        for (const row of [...first.items, ...second.items])
          assert.equal(
            ("rule" in row ? row.rule : row.incident).workspaceId,
            workspaceId,
          );
      }
      assert.equal(
        (
          await listWorkspaceScout(
            workspaceId,
            monitoringOverviewQuery.parse({ state: "active" }),
            true,
          )
        ).items.length,
        1,
      );
      assert.equal(
        (
          await listWorkspaceScout(
            workspaceId,
            monitoringOverviewQuery.parse({ state: "resolved" }),
            true,
          )
        ).items.length,
        1,
      );
      await db
        .update(scoutAlertRules)
        .set({ deletedAt: now })
        .where(eq(scoutAlertRules.id, rules[0]!.id));
      assert.equal(
        (
          await listWorkspaceScout(
            workspaceId,
            monitoringOverviewQuery.parse({}),
            false,
          )
        ).items.length,
        1,
      );
      const entities = await listMonitoringEntities(
        workspaceId,
        monitoringEntitiesQuery.parse({}),
      );
      assert.deepEqual(
        entities.entities.map((e) => e.id),
        [serverId],
      );
      assert.equal(
        (
          await listMonitoringEntities(
            workspaceId,
            monitoringEntitiesQuery.parse({ search: "192.0.2.241" }),
          )
        ).entities.length,
        0,
      );
      assert.equal(
        (
          await listMonitoringEntities(
            workspaceId,
            monitoringEntitiesQuery.parse({ kind: "app" }),
          )
        ).entities.length,
        0,
      );
      assert.equal(
        (
          await listMonitoringEntities(
            workspaceId,
            monitoringEntitiesQuery.parse({ after: entities.entities[0]!.key }),
          )
        ).entities.length,
        0,
      );
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
          await listWorkspaceScout(
            workspaceId,
            monitoringOverviewQuery.parse({}),
            true,
          )
        ).items.length,
        0,
      );
      assert.equal(
        (
          await listMonitoringEntities(
            workspaceId,
            monitoringEntitiesQuery.parse({}),
          )
        ).entities.length,
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
