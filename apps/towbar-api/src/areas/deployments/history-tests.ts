import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import {
  apps,
  deployments,
  sourceEnvironments,
} from "@workspace/towbar-database/schema";
import type {
  NormalizedApp,
  NormalizedResource,
  NormalizedServer,
} from "@workspace/towbar-core";
import type { TestContext } from "node:test";
import type { getTowbarDatabase } from "../../infrastructure/database.js";
import { listDeploymentHistory } from "./history.js";
import { historyQuerySchema } from "./history-query.js";

export async function testDeploymentHistory({
  t,
  db,
  workspaceId,
  otherWorkspaceId,
  sourceId,
  appId,
  serverId,
  actorUserId,
  appConfig,
  resourceConfig,
  serverConfig,
}: {
  t: TestContext;
  db: ReturnType<typeof getTowbarDatabase>;
  workspaceId: string;
  otherWorkspaceId: string;
  sourceId: string;
  appId: string;
  serverId: string;
  actorUserId: string;
  appConfig: NormalizedApp;
  resourceConfig: NormalizedResource;
  serverConfig: NormalizedServer;
}) {
  await t.test(
    "deployment history filters before pagination and sorts within its workspace",
    async () => {
      const resourceId = randomUUID();
      const environmentId = randomUUID();
      await db
        .insert(sourceEnvironments)
        .values({
          id: environmentId,
          sourceId,
          name: "staging",
          branch: "develop",
        });
      const ids = [randomUUID(), randomUUID(), randomUUID()];
      await db.insert(apps).values({
        id: resourceId,
        workspaceId,
        sourceId,
        serverId,
        sourceEnvironmentId: environmentId,
        manifestId: "history-resource",
        name: "Z Database",
        kind: "postgres",
        config: resourceConfig,
        configDigest: "history",
        sourceRevision: "1234567",
      });
      try {
        await db.insert(deployments).values(
          ids.map((id, index) => ({
            id,
            workspaceId,
            sourceId,
            serverId,
            appId: index === 2 ? resourceId : appId,
            idempotencyKey: id,
            temporalWorkflowId: id,
            commitSha: "1234567",
            manifestDigest: "history",
            appSnapshot: index === 2 ? resourceConfig : appConfig,
            serverSnapshot: serverConfig,
            createdAt: new Date(`2026-01-0${index + 1}T00:00:00Z`),
            state: index === 0 ? ("succeeded" as const) : ("failed" as const),
            deployableKind:
              index === 2 ? ("postgres" as const) : ("app" as const),
            requestedBy: index === 0 ? actorUserId : null,
            kind: index === 2 ? ("rollback" as const) : ("deploy" as const),
            rollbackReleaseSnapshot:
              index === 2
                ? {
                    commitSha: "1234567",
                    containerName: "history",
                    imageTag: "example:test",
                    releaseId: randomUUID(),
                    sourceDeploymentId: ids[0]!,
                  }
                : null,
          })),
        );
        const query = (input: Record<string, unknown> = {}) =>
          listDeploymentHistory({
            ...historyQuerySchema.parse(input),
            workspaceId,
          });
        const all = await query({ limit: 1 });
        assert.deepEqual(all.environments, ["production", "staging"]);
        assert.deepEqual(all.deployments[0]?.targetEnvironment, {
          id: environmentId,
          name: "staging",
        });
        const staging = await query({ targetEnvironment: "staging", limit: 1 });
        assert.equal(staging.pagination.total, 1);
        assert.equal(staging.deployments[0]?.id, ids[2]);
        assert.deepEqual(staging.environments, all.environments);
        assert.equal(
          (await query({ targetEnvironment: "production" })).pagination.total,
          2,
        );
        assert.equal(
          (await query({ targetEnvironment: "missing" })).pagination.total,
          0,
        );
        assert.deepEqual(
          (
            await listDeploymentHistory({
              workspaceId: otherWorkspaceId,
              page: 1,
              limit: 10,
            })
          ).environments,
          [],
        );
        assert.equal(all.pagination.total, 3);
        assert.equal(all.pagination.totalPages, 3);
        assert.equal(all.deployments[0]?.id, ids[2]);
        const filtered = await query({
          state: "failed",
          type: "resource",
          trigger: "rollback",
          serverId,
          environment: "production",
          limit: 1,
        });
        assert.equal(filtered.pagination.total, 1);
        assert.equal(filtered.deployments[0]?.id, ids[2]);
        assert.equal(
          (await query({ trigger: "manual" })).deployments[0]?.id,
          ids[0],
        );
        assert.equal(
          (await query({ trigger: "auto_deploy" })).deployments[0]?.id,
          ids[1],
        );
        assert.equal(
          (await query({ sort: "oldest", page: 2, limit: 1 })).deployments[0]
            ?.id,
          ids[1],
        );
        assert.equal(
          (await query({ sort: "name_asc" })).deployments[0]?.appId,
          appId,
        );
        assert.equal(
          (await query({ sort: "name_desc" })).deployments[0]?.appId,
          resourceId,
        );
        assert.equal(
          (await query({ environment: "preview" })).pagination.total,
          0,
        );
        assert.equal(
          (await query({ serverId: randomUUID() })).pagination.total,
          0,
        );
        assert.equal(
          (
            await listDeploymentHistory({
              workspaceId: otherWorkspaceId,
              page: 1,
              limit: 10,
            })
          ).pagination.total,
          0,
        );
        assert.equal(
          historyQuerySchema.safeParse({ sort: "invalid" }).success,
          false,
        );
        assert.equal(
          historyQuerySchema.safeParse({ state: "invalid" }).success,
          false,
        );
      } finally {
        await db.delete(deployments).where(inArray(deployments.id, ids));
        await db.delete(apps).where(eq(apps.id, resourceId));
        await db
          .delete(sourceEnvironments)
          .where(eq(sourceEnvironments.id, environmentId));
      }
    },
  );
}
