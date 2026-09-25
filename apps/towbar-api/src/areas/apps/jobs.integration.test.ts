import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import {
  normalizeDeploymentManifest,
  normalizeServerConfiguration,
} from "@workspace/towbar-core";
import {
  apps,
  deployments,
  releases,
  resourceOperations,
  servers,
  sourceEntities,
  sourceEnvironments,
  sources,
  users,
  workspaceMembers,
  workspaces,
} from "@workspace/towbar-database/schema";
import { seedEnvironmentTeam } from "../sources/environment-server-tests.js";

const url = process.env.TOWBAR_TEST_DATABASE_URL;
void test(
  "app jobs enforce admission, scheduler deduplication, current releases and live authorization",
  { skip: !url || !process.env.TOWBAR_TEST_TEMPORAL_ADDRESS },
  async () => {
    assert(url && new URL(url).pathname.endsWith("_test"));
    process.env.DATABASE_TOWBAR_URL = url;
    process.env.TEMPORAL_ADDRESS = process.env.TOWBAR_TEST_TEMPORAL_ADDRESS!;
    process.env.TOWBAR_CREDENTIALS_KEY = randomBytes(32).toString("base64");
    process.env.TOWBAR_INTERNAL_HMAC_SECRET = randomBytes(32).toString("hex");
    const { runTowbarMigrations } =
      await import("@workspace/towbar-database/migrate");
    await runTowbarMigrations({
      databaseUrl: url,
      logger: { info() {}, error() {} },
    });
    const { getTowbarDatabase, closeDatabase } =
      await import("../../infrastructure/database.js");
    const {
      listAppJobs,
      requestAppJob,
      queueScheduledAppJobs,
      validateQueuedAppJob,
    } = await import("./jobs.js");
    const { getOperationExecutionContext } =
      await import("../resource-operations/execution.js");
    const { withActor } = await import("../auth/actor-context.js");
    const { closeTemporalClient } =
      await import("../../infrastructure/temporal.js");
    const db = getTowbarDatabase();
    const workspaceId = randomUUID(),
      userId = randomUUID(),
      sourceId = randomUUID(),
      appId = randomUUID();
    const serverId = randomUUID(),
      otherServer = randomUUID(),
      entityId = randomUUID(),
      environmentId = randomUUID();
    const config = normalizeDeploymentManifest({
      version: 2,
      source: { branch: "main" },
      apps: [
        {
          id: "files",
          name: "Files",
          server: "192.0.2.10",
          dockerfile: "Dockerfile",
          rollout: {
            type: "recreate",
            reason: "The app uses a single-writer managed volume",
            maintenanceMode: true,
          },
          jobs: [
            {
              name: "report",
              command: ["node", "report.js"],
              schedule: { cron: "* * * * *" },
            },
          ],
          container: {
            port: 3000,
            volumes: [{ name: "uploads", mountPath: "/data" }],
          },
        },
      ],
    }).apps[0]!;
    const server = normalizeServerConfiguration({
      ip: "192.0.2.10",
      ssh: { username: "root" },
    });
    const secrets = { build: [], runtime: [], preDeploy: [], postDeploy: [] };
    try {
      await seedEnvironmentTeam({ workspaceId, userId, sourceId });
      await db.insert(servers).values([
        {
          id: serverId,
          workspaceId,
          canonicalIp: server.ip,
          config: server,
          configDigest: "test",
          preparedConfigDigest: "test",
          preparedAt: new Date(),
        },
        {
          id: otherServer,
          workspaceId,
          canonicalIp: "192.0.2.11",
          config: { ...server, ip: "192.0.2.11" },
          configDigest: "test",
        },
      ]);
      await db.insert(sourceEnvironments).values({
        id: environmentId,
        sourceId,
        name: "production",
        branch: "main",
      });
      await db.insert(sourceEntities).values({
        id: entityId,
        sourceId,
        entityType: "app",
        manifestId: "files",
      });
      await db.insert(apps).values({
        id: appId,
        workspaceId,
        sourceId,
        serverId,
        entityId,
        sourceEnvironmentId: environmentId,
        manifestId: "files",
        name: "Files",
        config,
        configDigest: "test",
        sourceRevision: "a".repeat(40),
        requiredSecrets: secrets,
      });
      const deploymentId = randomUUID();
      await db.insert(deployments).values({
        id: deploymentId,
        state: "succeeded",
        workspaceId,
        sourceId,
        serverId,
        appId,
        idempotencyKey: randomUUID(),
        temporalWorkflowId: randomUUID(),
        commitSha: "a".repeat(40),
        manifestDigest: "b".repeat(64),
        requiredSecrets: secrets,
        appSnapshot: config,
        serverSnapshot: server,
        targetEnvironment: {
          id: environmentId,
          name: "production",
          branch: "main",
          mappingRevision: randomUUID(),
        },
      });
      const releaseId = randomUUID();
      await db.insert(releases).values({
        id: releaseId,
        appId,
        deploymentId,
        status: "current",
        containerName: "test-app",
        imageTag: "test-image",
        commitSha: "a".repeat(40),
        promotedAt: new Date(Date.now() - 300_000),
      });
      const actor = {
        kind: "session" as const,
        workspaceId,
        userId,
        role: "admin" as const,
      };
      const request = {
        appId,
        workspaceId,
        jobName: "report",
        idempotencyKey: randomUUID(),
        requestedBy: userId,
      };
      const run = () => withActor(actor, () => requestAppJob(request));
      assert.equal((await listAppJobs(appId, workspaceId)).ready, true);
      await db
        .update(apps)
        .set({
          config: {
            ...config,
            notifications: {
              email: [
                {
                  address: "ops@example.com",
                  deployments: true,
                  backupsAndRestores: false,
                  alertsAndIncidents: false,
                },
              ],
            },
          },
        })
        .where(eq(apps.id, appId));
      assert.equal((await listAppJobs(appId, workspaceId)).ready, true);
      await assert.rejects(listAppJobs(appId, randomUUID()), /not found/i);
      await assert.rejects(
        withActor({ ...actor, role: "viewer" }, () => requestAppJob(request)),
        /not permitted/,
      );
      const [first, duplicate] = await Promise.all([run(), run()]);
      assert.equal(first.operation.id, duplicate.operation.id);
      assert.equal(Number(first.replayed) + Number(duplicate.replayed), 1);
      await assert.rejects(
        withActor(actor, () =>
          requestAppJob({ ...request, idempotencyKey: randomUUID() }),
        ),
        /already has/,
      );
      const now = new Date();
      assert.equal((await queueScheduledAppJobs(now)).queued, 0);
      await db
        .update(resourceOperations)
        .set({ state: "succeeded" })
        .where(eq(resourceOperations.id, first.operation.id));
      assert.equal((await queueScheduledAppJobs(now)).queued, 1);
      assert.equal((await queueScheduledAppJobs(now)).queued, 0);
      const scheduled = (await listAppJobs(appId, workspaceId)).runs.find(
        (r) => r.id !== first.operation.id,
      )!;
      assert.equal(scheduled.request.type, "run_job");
      if (scheduled.request.type !== "run_job")
        throw new Error("Expected a job");
      await db
        .update(sources)
        .set({ autoDeployPaused: true })
        .where(eq(sources.id, sourceId));
      await assert.rejects(
        validateQueuedAppJob({
          resourceId: appId,
          workspaceId,
          request: scheduled.request,
        }),
        /paused/,
      );
      assert.equal(
        (await queueScheduledAppJobs(new Date(now.getTime() + 60_000))).queued,
        0,
      );
      await db
        .update(sources)
        .set({ autoDeployPaused: false })
        .where(eq(sources.id, sourceId));
      await db
        .update(resourceOperations)
        .set({ state: "succeeded" })
        .where(eq(resourceOperations.id, scheduled.id));
      const manual = await withActor(actor, () =>
        requestAppJob({ ...request, idempotencyKey: randomUUID() }),
      );
      await db
        .update(workspaceMembers)
        .set({ role: "viewer" })
        .where(eq(workspaceMembers.userId, userId));
      await assert.rejects(
        getOperationExecutionContext(manual.operation.id),
        /Access changed/,
      );
      await db
        .update(workspaceMembers)
        .set({ role: "admin" })
        .where(eq(workspaceMembers.userId, userId));
      const context = await getOperationExecutionContext(manual.operation.id);
      assert.equal(context.request.type, "run_job");
      await assert.rejects(
        getOperationExecutionContext(manual.operation.id),
        /already complete/,
      );
      const { finishResourceOperation } =
        await import("../resource-operations/completion.js");
      await finishResourceOperation(manual.operation.id, {
        state: "failed",
        errorCode: "RESOURCE_OPERATION_FAILED",
        errorMessage: "Job exceeded its time limit",
        result: {
          jobName: "report",
          exitCode: 137,
          timedOut: true,
          logs: "[REDACTED]",
          truncated: false,
        },
      });
      const failed = (await listAppJobs(appId, workspaceId)).runs.find(
        (run) => run.id === manual.operation.id,
      );
      assert.equal(failed?.state, "failed");
      assert.deepEqual(failed?.result, {
        jobName: "report",
        exitCode: 137,
        timedOut: true,
        logs: "[REDACTED]",
        truncated: false,
      });
      await db
        .update(apps)
        .set({ config: { ...config, jobs: [] } })
        .where(eq(apps.id, appId));
      assert.equal((await listAppJobs(appId, workspaceId)).ready, false);
      await assert.rejects(
        validateQueuedAppJob({
          resourceId: appId,
          workspaceId,
          request: scheduled.request,
        }),
        /configuration changed/,
      );
    } finally {
      await db
        .delete(resourceOperations)
        .where(eq(resourceOperations.resourceId, appId));
      await db.delete(releases).where(eq(releases.appId, appId));
      await db.delete(deployments).where(eq(deployments.appId, appId));
      await db.delete(apps).where(eq(apps.id, appId));
      await db.delete(sources).where(eq(sources.id, sourceId));
      await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
      await db.delete(users).where(eq(users.id, userId));
      await closeTemporalClient();
      await closeDatabase();
    }
  },
);
