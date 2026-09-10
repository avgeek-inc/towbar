import { testInstanceLinks } from "../sources/instance-test-helper.js";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import {
  aggregateMonitoringValues,
  normalizeDeploymentManifest,
  normalizeServerConfiguration,
} from "@workspace/towbar-core";
import {
  apps,
  deployments,
  githubInstallations,
  monitoringAgents,
  monitoringSamples,
  servers,
  sources,
  workspaces,
} from "@workspace/towbar-database/schema";

const databaseUrl = process.env.TOWBAR_TEST_DATABASE_URL;
void test(
  "deployment comparison uses scoped, equal, coverage-aware history",
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
    const { getDeploymentComparison } =
      await import("./deployment-comparison.js");
    const db = getTowbarDatabase();
    const workspaceId = randomUUID(),
      serverId = randomUUID(),
      sourceId = randomUUID(),
      appId = randomUUID();
    const baselineId = randomUUID(),
      candidateId = randomUUID();
    const now = new Date("2026-09-06T12:00:00Z");
    const serverConfig = normalizeServerConfiguration({
      ip: "192.0.2.202",
      ssh: { username: "deploy" },
    });
    const appConfig = normalizeDeploymentManifest({
      version: 2,
      apps: [
        {
          id: "app",
          name: "App",
          server: "192.0.2.202",
          dockerfile: "Dockerfile",
          context: ".",
          container: { port: 3000 },
          health: { path: "/health" },
        },
      ],
    }).apps[0]!;
    const query = {
      baselineId,
      candidateId,
      workspaceId,
      deployableId: appId,
      windowMinutes: 30,
      warmupMinutes: 0,
      regressionPercent: 20,
      minimumCoveragePercent: 80,
    };
    try {
      await db.insert(workspaces).values({
        id: workspaceId,
        slug: workspaceId,
        name: "Comparison fixture",
      });
      await db.insert(servers).values({
        slug: `server-${serverId}`,
        id: serverId,
        workspaceId,
        canonicalIp: "192.0.2.202",
        config: serverConfig,
        configDigest: "fixture",
      });
      await db
        .insert(monitoringAgents)
        .values({ serverId, desiredState: "enabled", status: "online" });
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
        repositoryName: "comparison",
      });
      await db.insert(apps).values({
        ...(await testInstanceLinks(sourceId, "app")),
        id: appId,
        workspaceId,
        sourceId,
        serverId,
        manifestId: "app",
        name: "App",
        config: appConfig,
        configDigest: "fixture",
        sourceRevision: "abcdef0",
      });
      for (const [i, id] of [baselineId, candidateId].entries()) {
        const finishedAt = new Date(now.getTime() - (2 - i) * 3600_000);
        await db.insert(deployments).values({
          id,
          workspaceId,
          sourceId,
          appId,
          serverId,
          state: "succeeded",
          finishedAt,
          idempotencyKey: id,
          temporalWorkflowId: id,
          commitSha: `abcdef${i}`,
          manifestDigest: "fixture",
          appSnapshot: appConfig,
          serverSnapshot: serverConfig,
        });
        await db.insert(monitoringSamples).values(
          Array.from({ length: 60 }, (_, n) => ({
            serverId,
            deployableId: appId,
            deploymentId: id,
            // A container replacement half-way must not double the reported coverage.
            entityId: String(i * 2 + (n < 30 ? 1 : 2)).repeat(64),
            bucketAt: new Date(finishedAt.getTime() + n * 30_000),
            metrics: aggregateMonitoringValues({
              cpuCores: i ? 0.8 : 0.5,
              memoryUsedBytes: 100 * 1024 * 1024,
              restartCount: n < 30 ? 0 : 1,
            }),
          })),
        );
      }
      await t.test(
        "aligns windows, detects an increase, and keeps coverage at 100%",
        async () => {
          const result = await getDeploymentComparison(query, now);
          const cpu = result.metrics.find((m) => m.metric === "cpuCores")!;
          assert.equal(cpu.assessment, "increased");
          assert.equal(cpu.baseline.coveragePercent, 100);
          assert.equal(cpu.candidate.coveragePercent, 100);
          assert(Math.abs(cpu.deltaPercent! - 60) < 0.001);
          assert.equal(result.baseline.restarts, 0);
          assert.equal(result.candidate.restarts, 0);
          assert.equal(result.baseline.points[0]?.offsetSeconds, 0);
          assert.equal(result.candidate.points[0]?.offsetSeconds, 0);
          assert(result.baseline.points.length <= 240);
        },
      );
      await t.test(
        "absolute and relative sensitivity can suppress immaterial increases",
        async () => {
          const result = await getDeploymentComparison(
            { ...query, cpuFloorCores: 0.4, statistic: "peak" },
            now,
          );
          assert.equal(
            result.metrics.find((metric) => metric.metric === "cpuCores")
              ?.assessment,
            "stable",
          );
          const lessSensitive = await getDeploymentComparison(
            { ...query, regressionPercent: 80 },
            now,
          );
          assert.equal(
            lessSensitive.metrics.find((metric) => metric.metric === "cpuCores")
              ?.assessment,
            "stable",
          );
          assert(
            result.warnings.some((warning) => warning.includes("same instant")),
          );
        },
      );
      await t.test(
        "rejects cross-tenant, wrong workload, and identical IDs",
        async () => {
          await assert.rejects(
            getDeploymentComparison(
              { ...query, workspaceId: randomUUID() },
              now,
            ),
          );
          await assert.rejects(
            getDeploymentComparison(
              { ...query, deployableId: randomUUID() },
              now,
            ),
          );
          await assert.rejects(
            getDeploymentComparison({ ...query, candidateId: baselineId }, now),
          );
        },
      );
      await t.test(
        "incomplete windows keep the requested denominator and report missing data",
        async () => {
          const result = await getDeploymentComparison(
            query,
            new Date(now.getTime() - 55 * 60_000),
          );
          assert.equal(result.candidate.windowComplete, false);
          assert.equal(
            result.metrics.find((m) => m.metric === "cpuCores")!.assessment,
            "insufficient_data",
          );
          assert(
            result.warnings.some((warning) =>
              warning.includes("still collecting"),
            ),
          );
        },
      );
      await t.test(
        "expired data is not represented as zero resource usage",
        async () => {
          const result = await getDeploymentComparison(
            query,
            new Date(now.getTime() + 16 * 86400_000),
          );
          assert.equal(result.baseline.historyExpired, true);
          assert.equal(result.metrics[0]!.baseline.average, null);
          assert.equal(result.metrics[0]!.assessment, "insufficient_data");
        },
      );
      await t.test(
        "failed deployments cannot be presented as successful performance windows",
        async () => {
          await db
            .update(deployments)
            .set({ state: "failed" })
            .where(eq(deployments.id, candidateId));
          await assert.rejects(
            getDeploymentComparison(query, now),
            /successful deployments/,
          );
        },
      );
    } finally {
      await db
        .delete(deployments)
        .where(eq(deployments.workspaceId, workspaceId));
      await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
      await closeDatabase();
    }
  },
);
