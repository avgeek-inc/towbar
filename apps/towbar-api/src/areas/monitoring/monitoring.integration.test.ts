import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { eq, sql } from "drizzle-orm";
import {
  aggregateMonitoringValues,
  monitoringSampleSchema,
  normalizeDeploymentManifest,
  normalizeServerConfiguration,
} from "@workspace/towbar-core";
import {
  apps,
  deployments,
  githubInstallations,
  monitoringAgents,
  monitoringSamples,
  previewEnvironments,
  servers,
  sources,
  workspaces,
} from "@workspace/towbar-database/schema";

const databaseUrl = process.env.TOWBAR_TEST_DATABASE_URL;
void test(
  "monitoring authentication, ingestion, and durable retention",
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
    const { authenticateAgent, hashAgentToken, ingestMonitoringSample } =
      await import("./ingest.js");
    const { maintainMonitoringMetrics } = await import("./retention.js");
    const db = getTowbarDatabase();
    const workspaceId = randomUUID(),
      serverId = randomUUID(),
      generation = randomUUID();
    const token = `twma_${randomBytes(32).toString("hex")}`;
    const now = new Date("2026-09-06T12:00:00Z");
    const sample = () =>
      monitoringSampleSchema.parse({
        id: randomBytes(16).toString("hex"),
        collectedAt: now.toISOString(),
        version: "1.0.0",
        collectionDurationMs: 10,
        collectionErrors: 0,
        droppedSamples: 0,
        entities: [
          { id: "host", metrics: { cpuPercent: 10, memoryPercent: 30 } },
        ],
      });
    try {
      await db.insert(workspaces).values({
        id: workspaceId,
        slug: workspaceId,
        name: "Monitoring test",
      });
      await db.insert(servers).values({
        id: serverId,
        workspaceId,
        canonicalIp: "192.0.2.201",
        config: normalizeServerConfiguration({
          ip: "192.0.2.201",
          ssh: { username: "deploy" },
        }),
        configDigest: "test",
      });
      await db.insert(monitoringAgents).values({
        serverId,
        generation,
        desiredState: "enabled",
        status: "waiting",
        tokenHash: hashAgentToken(token),
      });
      await t.test(
        "credential is scoped to one active registration",
        async () => {
          assert.equal(await authenticateAgent(serverId, token), generation);
          await assert.rejects(authenticateAgent(serverId, `${token}bad`));
          await assert.rejects(authenticateAgent(randomUUID(), token));
          await assert.rejects(
            ingestMonitoringSample(serverId, randomUUID(), sample(), now),
          );
        },
      );
      await t.test(
        "concurrent replay writes one sample and does not duplicate history",
        async () => {
          const body = sample();
          const responses = await Promise.all([
            ingestMonitoringSample(serverId, generation, body, now),
            ingestMonitoringSample(serverId, generation, body, now),
          ]);
          assert.equal(responses.filter((r) => r.replayed).length, 1);
          const rows = await db
            .select()
            .from(monitoringSamples)
            .where(eq(monitoringSamples.serverId, serverId));
          assert.equal(rows.length, 1);
          const [agent] = await db
            .select()
            .from(monitoringAgents)
            .where(eq(monitoringAgents.serverId, serverId));
          assert.equal(agent?.status, "online");
          assert.equal(agent?.ingestCount, 1);
        },
      );
      await t.test(
        "rejects expired/future samples and ignores unknown workload claims",
        async () => {
          await assert.rejects(
            ingestMonitoringSample(
              serverId,
              generation,
              {
                ...sample(),
                collectedAt: new Date(
                  now.getTime() - 3 * 3600_000,
                ).toISOString(),
              },
              now,
            ),
          );
          await assert.rejects(
            ingestMonitoringSample(
              serverId,
              generation,
              {
                ...sample(),
                collectedAt: new Date(now.getTime() + 3 * 60_000).toISOString(),
              },
              now,
            ),
          );
          const body = sample();
          body.entities.push({
            id: "a".repeat(64),
            containerId: "a".repeat(64),
            deployableId: randomUUID(),
            metrics: { cpuPercent: 95 },
          });
          assert.equal(
            (await ingestMonitoringSample(serverId, generation, body, now))
              .accepted,
            0,
          );
        },
      );
      await t.test(
        "rollups preserve averages and peaks, reruns never count a sample twice",
        async () => {
          const bucketAt = new Date(now.getTime() - 2 * 86400_000);
          await db.insert(monitoringSamples).values(
            [10, 90].map((cpu, index) => ({
              serverId,
              entityId: "host",
              bucketAt: new Date(bucketAt.getTime() + index * 30_000),
              metrics: aggregateMonitoringValues({ cpuPercent: cpu }),
            })),
          );
          await maintainMonitoringMetrics(now);
          await maintainMonitoringMetrics(now);
          const rows = await db
            .select()
            .from(monitoringSamples)
            .where(
              sql`${monitoringSamples.serverId}=${serverId} and ${monitoringSamples.resolution}=60`,
            );
          assert.equal(rows.length, 1);
          assert.deepEqual(rows[0]?.metrics.cpuPercent, {
            sum: 100,
            min: 10,
            max: 90,
            count: 2,
          });
        },
      );
      await t.test(
        "default retention expires history and reducing retention removes older data",
        async () => {
          await db.insert(monitoringSamples).values({
            serverId,
            entityId: "host",
            resolution: 60,
            bucketAt: new Date(now.getTime() - 16 * 86400_000),
            metrics: aggregateMonitoringValues({ cpuPercent: 50 }),
          });
          await maintainMonitoringMetrics(now);
          const [countResult] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(monitoringSamples)
            .where(
              sql`${monitoringSamples.serverId}=${serverId} and ${monitoringSamples.bucketAt}<${new Date(now.getTime() - 15 * 86400_000).toISOString()}::timestamptz`,
            );
          assert.equal(countResult?.count, 0);
          await db
            .update(monitoringAgents)
            .set({ retentionDays: 60 })
            .where(eq(monitoringAgents.serverId, serverId));
          await db.insert(monitoringSamples).values({
            serverId,
            entityId: "host",
            resolution: 60,
            bucketAt: new Date(now.getTime() - 30 * 86400_000),
            metrics: aggregateMonitoringValues({ cpuPercent: 50 }),
          });
          await maintainMonitoringMetrics(now);
          await db
            .update(monitoringAgents)
            .set({ retentionDays: 7 })
            .where(eq(monitoringAgents.serverId, serverId));
          await maintainMonitoringMetrics(now);
          const [oldResult] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(monitoringSamples)
            .where(
              sql`${monitoringSamples.serverId}=${serverId} and ${monitoringSamples.bucketAt}<${new Date(now.getTime() - 7 * 86400_000).toISOString()}::timestamptz`,
            );
          assert.equal(oldResult?.count, 0);
        },
      );
      await t.test(
        "history preserves per-instance aggregates and rejects other workspaces",
        async () => {
          const { getMonitoringHistory } = await import("./queries.js");
          const history = await getMonitoringHistory(
            { serverId, workspaceId, range: "1h", environment: "production" },
            now,
          );
          assert.equal(history.series[0]?.id, "host");
          assert.equal(
            history.series[0]?.points[0]?.metrics.cpuPercent?.max,
            10,
          );
          assert(history.stepSeconds >= 30);
          assert(history.series.every((row) => row.points.length <= 361));
          await assert.rejects(
            getMonitoringHistory(
              {
                serverId,
                workspaceId: randomUUID(),
                range: "1h",
                environment: "production",
              },
              now,
            ),
          );
          const longHistory = await getMonitoringHistory(
            { serverId, workspaceId, range: "60d", environment: "production" },
            now,
          );
          assert.equal(
            new Date(longHistory.startAt).getTime(),
            now.getTime() - 7 * 86400_000,
          );
        },
      );
      await t.test(
        "a repeated completion cannot mark a successful agent failed",
        async () => {
          const { finishMonitoringOperation, getMonitoringExecutionContext } =
            await import("./lifecycle.js");
          await db
            .update(monitoringAgents)
            .set({ status: "installing", operationStartedAt: now })
            .where(eq(monitoringAgents.serverId, serverId));
          await finishMonitoringOperation(serverId, generation, true);
          await finishMonitoringOperation(serverId, generation, false);
          const [agent] = await db
            .select()
            .from(monitoringAgents)
            .where(eq(monitoringAgents.serverId, serverId));
          assert.equal(agent?.status, "online");
          assert.equal(
            await getMonitoringExecutionContext(serverId, generation),
            null,
          );
        },
      );
      await t.test(
        "parallel rollups preserve counts across batch boundaries",
        async () => {
          const entityId = "f".repeat(64);
          const start = new Date(now.getTime() - 5 * 86400_000).toISOString();
          await db.execute(sql`insert into towbar_monitoring_samples(server_id,entity_id,bucket_at,resolution,metrics)
          select ${serverId}::uuid,${entityId},${start}::timestamptz+n*interval '30 seconds',30,
          jsonb_build_object('cpuPercent',jsonb_build_object('sum',n%100,'min',n%100,'max',n%100,'count',1)) from generate_series(0,10000) n`);
          await Promise.all([
            maintainMonitoringMetrics(now),
            maintainMonitoringMetrics(now),
          ]);
          const [count] = await db.execute<{
            samples: number;
            raw: number;
            peak: number;
          }>(
            sql`select sum((metrics->'cpuPercent'->>'count')::integer)::int samples,count(*) filter(where resolution=30)::int raw,max((metrics->'cpuPercent'->>'max')::integer)::int peak from towbar_monitoring_samples where server_id=${serverId}::uuid and entity_id=${entityId}`,
          );
          assert.equal(count?.samples, 10001);
          assert.equal(count?.raw, 0);
          assert.equal(count?.peak, 99);
          await db
            .delete(monitoringSamples)
            .where(
              sql`${monitoringSamples.serverId}=${serverId}::uuid and ${monitoringSamples.entityId}=${entityId}`,
            );
        },
      );
      await t.test(
        "production, previews, and replacement containers stay separate",
        async () => {
          const sourceId = randomUUID(),
            appId = randomUUID();
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
            repositoryName: "metrics",
            branch: "main",
          });
          const config = normalizeDeploymentManifest({
            version: 1,
            apps: [
              {
                id: "app",
                name: "App",
                server: "192.0.2.201",
                dockerfile: "Dockerfile",
                context: ".",
                container: { port: 3000 },
                health: { path: "/health" },
              },
            ],
          }).apps[0]!;
          await db.insert(apps).values({
            id: appId,
            workspaceId,
            sourceId,
            serverId,
            manifestId: "app",
            name: "App",
            config,
            configDigest: "test",
            sourceRevision: "abcdef0",
          });
          const previews = [randomUUID(), randomUUID()];
          for (const [i, id] of previews.entries())
            await db.insert(previewEnvironments).values({
              id,
              workspaceId,
              sourceId,
              appId,
              serverId,
              pullRequestNumber: i + 1,
              branch: `preview-${i}`,
              gitRef: `refs/pull/${i + 1}/head`,
              hostname: `pr-${i}.example.com`,
              runtimeId: id,
              latestCommitSha: "abcdef0",
              expiresAt: new Date(now.getTime() + 86400_000),
            });
          const deploymentIds = [randomUUID(), randomUUID(), randomUUID()];
          for (const [i, id] of deploymentIds.entries())
            await db.insert(deployments).values({
              id,
              workspaceId,
              sourceId,
              appId,
              serverId,
              idempotencyKey: id,
              temporalWorkflowId: id,
              commitSha: "abcdef0",
              manifestDigest: "test",
              appSnapshot: config,
              serverSnapshot: normalizeServerConfiguration({
                ip: "192.0.2.201",
                ssh: { username: "deploy" },
              }),
              ...(i
                ? {
                    environment: "preview" as const,
                    previewEnvironmentId: previews[i - 1]!,
                    gitRef: `refs/pull/${i}/head`,
                    hostname: `pr-${i - 1}.example.com`,
                  }
                : {}),
            });
          const body = sample();
          body.entities.push(
            ...deploymentIds.map((deploymentId, i) => ({
              id: String(i + 1).repeat(64),
              containerId: String(i + 1).repeat(64),
              deployableId: appId,
              deploymentId,
              previewId: randomUUID(),
              metrics: { cpuPercent: 10 * (i + 1) },
            })),
          );
          body.entities.push({
            id: "4".repeat(64),
            containerId: "4".repeat(64),
            deployableId: appId,
            deploymentId: deploymentIds[0]!,
            metrics: { cpuPercent: 40 },
          });
          body.entities.push({
            id: "5".repeat(64),
            containerId: "5".repeat(64),
            deployableId: randomUUID(),
            deploymentId: deploymentIds[0]!,
            metrics: { cpuPercent: 99 },
          });
          assert.equal(
            (await ingestMonitoringSample(serverId, generation, body, now))
              .accepted,
            4,
          );
          const { getMonitoringHistory } = await import("./queries.js");
          const query = {
            workspaceId,
            deployableId: appId,
            kind: "app" as const,
            range: "1h" as const,
          };
          const production = await getMonitoringHistory(
            { ...query, environment: "production" },
            now,
          );
          assert.equal(production.series.length, 2);
          assert(production.series.every((row) => row.previewId === null));
          const preview = await getMonitoringHistory(
            { ...query, environment: "preview" },
            now,
          );
          assert.deepEqual(
            new Set(preview.series.map((row) => row.previewId)),
            new Set(previews),
          );
          const isolated = await getMonitoringHistory(
            { ...query, environment: "preview", previewId: previews[0]! },
            now,
          );
          assert.equal(isolated.series.length, 1);
          assert.equal(
            isolated.series[0]?.points[0]?.metrics.cpuPercent?.max,
            20,
          );
          await db
            .delete(deployments)
            .where(eq(deployments.sourceId, sourceId));
        },
      );
      await t.test(
        "revocation blocks an already authenticated in-flight sender",
        async () => {
          await db
            .update(monitoringAgents)
            .set({ desiredState: "disabled", tokenHash: null })
            .where(eq(monitoringAgents.serverId, serverId));
          await assert.rejects(authenticateAgent(serverId, token));
          await assert.rejects(
            ingestMonitoringSample(serverId, generation, sample(), now),
          );
        },
      );
    } finally {
      await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
      await closeDatabase();
    }
  },
);
