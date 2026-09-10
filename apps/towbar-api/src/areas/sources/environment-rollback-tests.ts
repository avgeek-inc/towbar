import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { eq, sql } from "drizzle-orm";
import {
  apps,
  deployments,
  previewEnvironments,
  releases,
  servers,
} from "@workspace/towbar-database/schema";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import { requestAppRollback } from "../apps/service.js";
import { testDeploymentEnvironment } from "./instance-test-helper.js";

export async function assertRollbackAdmission(
  instance: typeof apps.$inferSelect,
) {
  const db = getTowbarDatabase();
  const [server] = await db
    .select()
    .from(servers)
    .where(eq(servers.id, instance.serverId));
  assert(server);
  const previewId = randomUUID();
  const deploymentId = randomUUID(),
    releaseId = randomUUID();
  try {
    await db
      .update(servers)
      .set({
        preparedAt: new Date(),
        preparedConfigDigest: server.configDigest,
      })
      .where(eq(servers.id, server.id));
    await db.insert(deployments).values({
      id: deploymentId,
      idempotencyKey: deploymentId,
      workspaceId: instance.workspaceId,
      sourceId: instance.sourceId,
      appId: instance.id,
      serverId: server.id,
      commitSha: instance.sourceRevision,
      appSnapshot: instance.config,
      serverSnapshot: server.config,
      requiredSecrets: instance.requiredSecrets,
      targetEnvironment: await testDeploymentEnvironment(instance.id),
      manifestDigest: "rollback-test",
      temporalWorkflowId: deploymentId,
    });
    await db.insert(previewEnvironments).values({
      id: previewId,
      sourceId: instance.sourceId,
      workspaceId: instance.workspaceId,
      appId: instance.id,
      serverId: server.id,
      pullRequestNumber: 91,
      branch: "feature",
      gitRef: "refs/pull/91/head",
      hostname: "rollback-preview.example.com",
      runtimeId: previewId,
      latestCommitSha: instance.sourceRevision,
      expiresAt: new Date(Date.now() + 3600000),
    });
    await db.insert(releases).values({
      id: releaseId,
      appId: instance.id,
      deploymentId,
      environment: "preview",
      previewEnvironmentId: previewId,
      gitRef: "refs/pull/91/head",
      status: "previous",
      commitSha: instance.sourceRevision,
      deploymentDigest: "rollback-test",
      imageTag: "test:previous",
      containerName: "test-previous",
    });
    const request = {
      appId: instance.id,
      workspaceId: instance.workspaceId,
      requestedBy: randomUUID(),
      idempotencyKey: randomUUID(),
      releaseId,
    };
    await assert.rejects(requestAppRollback(request), /Release was not found/);
    await db
      .update(releases)
      .set({
        environment: "production",
        previewEnvironmentId: null,
        gitRef: null,
      })
      .where(eq(releases.id, releaseId));
    let result: Promise<unknown> | undefined;
    await db.transaction(async (transaction) => {
      await transaction
        .select()
        .from(apps)
        .where(eq(apps.id, instance.id))
        .for("update");
      result = requestAppRollback(request).then(
        () => ({ accepted: true }),
        (error) => ({ error }),
      );
      const deadline = Date.now() + 5000;
      let waiting = false;
      while (Date.now() < deadline) {
        await transaction.execute(sql`select pg_stat_clear_snapshot()`);
        const rows = await transaction.execute<{ waiting: boolean }>(
          sql`select exists(select 1 from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() and wait_event_type='Lock' and query ilike '%towbar_apps%' and query ilike '%for update%') as waiting`,
        );
        if (rows[0]?.waiting) {
          waiting = true;
          break;
        }
        await delay(20);
      }
      assert(waiting, "Rollback must lock the instance before admission");
      await transaction
        .update(apps)
        .set({ archivedAt: new Date() })
        .where(eq(apps.id, instance.id));
    });
    const outcome = (await result) as { error?: Error };
    assert.match(
      outcome.error?.message ?? "",
      /Archived apps cannot be rolled back/,
    );
    const admitted = await db
      .select()
      .from(deployments)
      .where(eq(deployments.kind, "rollback"));
    assert(
      !admitted.some((row) => row.appId === instance.id),
      "The raced rollback must not be inserted",
    );
  } finally {
    await db
      .update(apps)
      .set({ archivedAt: instance.archivedAt })
      .where(eq(apps.id, instance.id));
    await db.delete(releases).where(eq(releases.id, releaseId));
    await db
      .delete(previewEnvironments)
      .where(eq(previewEnvironments.id, previewId));
    await db.delete(deployments).where(eq(deployments.id, deploymentId));
    await db
      .update(servers)
      .set({
        preparedAt: server.preparedAt,
        preparedConfigDigest: server.preparedConfigDigest,
      })
      .where(eq(servers.id, server.id));
  }
}
