import { randomUUID } from "node:crypto";

import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  backupOperationResultSchema,
  isNormalizedResource,
} from "@workspace/towbar-core";
import { resourceOperationWorkflowId } from "@workspace/towbar-core/temporal";
import {
  apps,
  deployableRuntimeStates,
  resourceOperations,
  servers,
  sshHostKeys,
} from "@workspace/towbar-database/schema";

import { conflict, notFound, unprocessable } from "../../http/errors.js";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import { enqueueResourceOperation } from "../../infrastructure/temporal.js";
import { getDecryptedAwsCredential, resolveAwsSecret } from "../aws/service.js";
import { resolveRuntimeEnvironmentSecrets } from "../deployments/deployment-secrets.js";
import { emitResourceOperationNotification } from "../notifications/events.js";
import {
  requestServerCheck,
  sshLoginSecretSchema,
} from "../servers/service.js";
import {
  getCleanupExpected,
  getDeployableTarget,
  getRetentionBackups,
  getServerOrphans,
  publicOperationSelection,
} from "./queries.js";

import type {
  ResourceOperationRequest,
  ResourceOperationResult,
} from "@workspace/towbar-core";

export { getServerOrphans } from "./queries.js";

export async function listDeployableOperations(
  deployableId: string,
  workspaceId: string,
) {
  await getDeployableTarget(deployableId, workspaceId);
  return await getTowbarDatabase()
    .select(publicOperationSelection)
    .from(resourceOperations)
    .where(eq(resourceOperations.resourceId, deployableId))
    .orderBy(desc(resourceOperations.createdAt));
}

export async function listSourceBackups(sourceId: string, workspaceId: string) {
  return await getTowbarDatabase()
    .select({
      ...publicOperationSelection,
      resourceKind: apps.kind,
      resourceManifestId: apps.manifestId,
      resourceName: apps.name,
    })
    .from(resourceOperations)
    .innerJoin(apps, eq(apps.id, resourceOperations.resourceId))
    .where(
      and(
        eq(resourceOperations.sourceId, sourceId),
        eq(resourceOperations.workspaceId, workspaceId),
        eq(resourceOperations.type, "backup"),
        eq(resourceOperations.state, "succeeded"),
        isNull(resourceOperations.deletedAt),
      ),
    )
    .orderBy(desc(resourceOperations.createdAt));
}

export async function requestDeployableOperation(input: {
  deployableId: string;
  idempotencyKey: string;
  requestedBy: string | null;
  request:
    | { type: "backup" }
    | { tail: number; type: "capture_logs" }
    | { type: "restart" | "start" | "stop" };
  workspaceId: string;
}) {
  const target = await getDeployableTarget(
    input.deployableId,
    input.workspaceId,
  );
  if (target.archivedAt) {
    throw conflict("Archived deployables cannot be operated");
  }
  if (
    !target.serverPreparedAt ||
    target.serverPreparedConfigDigest !== target.serverConfigDigest
  ) {
    throw conflict(
      "Prepare this server before operating apps or resources",
      "SERVER_SETUP_PENDING",
    );
  }
  if (!target.currentRelease) {
    throw unprocessable("Deploy this item before using runtime operations");
  }
  const release = target.currentRelease;
  if (input.request.type === "backup") {
    requireBackupResource(target.config);
  }
  return await admitOperation({
    appSnapshot: target.config,
    idempotencyKey: input.idempotencyKey,
    request: { ...input.request, release },
    requestedBy: input.requestedBy,
    resourceId: target.id,
    serverId: target.serverId,
    serverIp: target.serverIp,
    serverSnapshot: target.serverConfig,
    sourceId: target.sourceId,
    workspaceId: input.workspaceId,
  });
}

export async function requestOrphanCleanup(input: {
  idempotencyKey: string;
  items: Array<{ kind: "container" | "image" | "volume"; name: string }>;
  requestedBy: string;
  serverId: string;
  sourceId: string;
  workspaceId: string;
}) {
  const [server] = await getTowbarDatabase()
    .select({
      config: servers.config,
      id: servers.id,
      ip: servers.canonicalIp,
      sourceId: servers.sourceId,
    })
    .from(servers)
    .where(
      and(
        eq(servers.id, input.serverId),
        eq(servers.workspaceId, input.workspaceId),
        eq(servers.sourceId, input.sourceId),
      ),
    )
    .limit(1);
  if (!server) throw notFound("Source server");
  const latestOrphans = await getServerOrphans(server.id, input.workspaceId);
  const requested = new Map(
    input.items.map((item) => [`${item.kind}:${item.name}`, item]),
  );
  const selected = latestOrphans.filter((item) =>
    requested.has(`${item.kind}:${item.name}`),
  );
  if (selected.length !== requested.size || selected.length === 0) {
    throw conflict(
      "Run a fresh server check and select only its current scoped orphans",
      "ORPHAN_SNAPSHOT_STALE",
    );
  }
  return await admitOperation({
    appSnapshot: null,
    exclusive: true,
    idempotencyKey: input.idempotencyKey,
    request: { items: selected, type: "cleanup_orphans" },
    requestedBy: input.requestedBy,
    resourceId: null,
    serverId: server.id,
    serverIp: server.ip,
    serverSnapshot: server.config,
    sourceId: server.sourceId,
    workspaceId: input.workspaceId,
  });
}

export async function getOperationExecutionContext(operationId: string) {
  const [operation] = await getTowbarDatabase()
    .select()
    .from(resourceOperations)
    .where(eq(resourceOperations.id, operationId))
    .limit(1);
  if (!operation) throw notFound("Resource operation");
  if (operation.request.type === "restore") {
    throw conflict("Towbar-managed database restore is no longer supported");
  }
  if (operation.state === "queued") {
    await getTowbarDatabase()
      .update(resourceOperations)
      .set({ startedAt: new Date(), state: "running", updatedAt: new Date() })
      .where(
        and(
          eq(resourceOperations.id, operationId),
          eq(resourceOperations.state, "queued"),
        ),
      );
  } else if (operation.state !== "running") {
    throw conflict("Resource operation is already complete");
  }
  const trustedHostKeys = await getTowbarDatabase()
    .select({
      algorithm: sshHostKeys.algorithm,
      fingerprint: sshHostKeys.fingerprint,
      publicKey: sshHostKeys.publicKey,
    })
    .from(sshHostKeys)
    .where(
      and(
        eq(sshHostKeys.serverId, operation.serverId),
        isNull(sshHostKeys.revokedAt),
      ),
    );
  const currentRelease =
    operation.request.type === "cleanup_orphans"
      ? null
      : operation.request.release;
  const cleanupExpected = await getCleanupExpected(operation.serverId);
  return {
    cleanupExpected,
    currentRelease,
    deployable: operation.appSnapshot,
    deployableId: operation.resourceId,
    operationId: operation.id,
    request: operation.request,
    retentionBackups:
      operation.request.type === "backup" && operation.resourceId
        ? await getRetentionBackups(operation.resourceId, operation.appSnapshot)
        : [],
    server: operation.serverSnapshot,
    sourceId: operation.sourceId,
    trustedHostKeys,
  };
}

export async function resolveOperationSecrets(operationId: string) {
  const [operation] = await getTowbarDatabase()
    .select({
      app: resourceOperations.appSnapshot,
      request: resourceOperations.request,
      resourceId: resourceOperations.resourceId,
      server: resourceOperations.serverSnapshot,
      sourceId: resourceOperations.sourceId,
      workspaceId: resourceOperations.workspaceId,
    })
    .from(resourceOperations)
    .where(eq(resourceOperations.id, operationId))
    .limit(1);
  if (!operation) throw notFound("Resource operation");
  if (operation.request.type === "restore") {
    throw conflict("Towbar-managed database restore is no longer supported");
  }
  const login = sshLoginSecretSchema.parse(
    await resolveAwsSecret({
      secretReference: operation.server.secrets.login,
      sourceId: operation.sourceId,
      workspaceId: operation.workspaceId,
    }),
  );
  const runtime =
    operation.request.type === "capture_logs" && operation.app
      ? await resolveRuntimeEnvironmentSecrets({
          app: operation.app,
          sourceId: operation.sourceId,
          workspaceId: operation.workspaceId,
        })
      : {};
  const requiresAws = operation.request.type === "backup";
  const awsCredential = requiresAws
    ? await getDecryptedAwsCredential({
        sourceId: operation.sourceId,
        workspaceId: operation.workspaceId,
      })
    : null;
  return {
    aws: awsCredential
      ? { ...awsCredential.payload, region: awsCredential.region }
      : null,
    login,
    sensitiveValues: [
      login.privateKey,
      ...(awsCredential ? [awsCredential.payload.secretAccessKey] : []),
      ...Object.values(runtime),
    ],
  };
}

export async function finishResourceOperation(
  operationId: string,
  input:
    | { result: ResourceOperationResult; state: "succeeded" }
    | { errorCode: string; errorMessage: string; state: "failed" },
) {
  const operation = await getTowbarDatabase().transaction(
    async (transaction) => {
      const [current] = await transaction
        .select()
        .from(resourceOperations)
        .where(eq(resourceOperations.id, operationId))
        .for("update")
        .limit(1);
      if (!current) throw notFound("Resource operation");
      if (["failed", "succeeded"].includes(current.state)) return current;
      const finishedAt = new Date();
      const [updated] = await transaction
        .update(resourceOperations)
        .set({
          errorCode: input.state === "failed" ? input.errorCode : null,
          errorMessage: input.state === "failed" ? input.errorMessage : null,
          finishedAt,
          result: input.state === "succeeded" ? input.result : null,
          state: input.state,
          updatedAt: finishedAt,
        })
        .where(eq(resourceOperations.id, current.id))
        .returning();
      if (!updated) throw new Error("Unable to finish Resource operation");
      if (input.state === "succeeded" && current.resourceId) {
        if (["restart", "start", "stop"].includes(current.type)) {
          await transaction
            .insert(deployableRuntimeStates)
            .values({
              appId: current.resourceId,
              desiredState: current.type === "stop" ? "stopped" : "running",
              updatedAt: finishedAt,
            })
            .onConflictDoUpdate({
              target: deployableRuntimeStates.appId,
              set: {
                desiredState: current.type === "stop" ? "stopped" : "running",
                updatedAt: finishedAt,
              },
            });
        }
        if (current.type === "backup") {
          const result = backupOperationResultSchema.parse(input.result);
          if (result.deletedBackupIds.length) {
            await transaction
              .update(resourceOperations)
              .set({ deletedAt: finishedAt, updatedAt: finishedAt })
              .where(
                and(
                  inArray(resourceOperations.id, result.deletedBackupIds),
                  eq(resourceOperations.resourceId, current.resourceId),
                ),
              );
          }
        }
      }
      return updated;
    },
  );
  if (
    input.state === "succeeded" &&
    ["cleanup_orphans", "restart", "start", "stop"].includes(operation.type)
  ) {
    await requestServerCheck({
      requestedBy: null,
      serverId: operation.serverId,
      sourceId: operation.sourceId,
      workspaceId: operation.workspaceId,
    }).catch(() => undefined);
  }
  if (operation.state === "failed" && operation.type === "backup") {
    await emitResourceOperationNotification(
      operation.id,
      "backup.failed",
    ).catch(() => undefined);
  }
  if (operation.type === "restore") {
    await emitResourceOperationNotification(
      operation.id,
      operation.state === "succeeded" ? "restore.succeeded" : "restore.failed",
    ).catch(() => undefined);
  }
  return operation;
}

async function admitOperation(input: {
  appSnapshot: (typeof apps.$inferSelect)["config"] | null;
  exclusive?: boolean;
  idempotencyKey: string;
  request: ResourceOperationRequest;
  requestedBy: string | null;
  resourceId: string | null;
  serverId: string;
  serverIp: string;
  serverSnapshot: (typeof servers.$inferSelect)["config"];
  sourceId: string;
  workspaceId: string;
}) {
  const scopedKey = `${input.request.type}:${input.resourceId ?? input.serverId}:${input.idempotencyKey}`;
  const [existing] = await getTowbarDatabase()
    .select(publicOperationSelection)
    .from(resourceOperations)
    .where(
      and(
        eq(resourceOperations.workspaceId, input.workspaceId),
        eq(resourceOperations.idempotencyKey, scopedKey),
      ),
    )
    .limit(1);
  if (existing) return { operation: existing, replayed: true };
  const id = randomUUID();
  let created;
  try {
    [created] = await getTowbarDatabase()
      .insert(resourceOperations)
      .values({
        appSnapshot: input.appSnapshot,
        id,
        idempotencyKey: scopedKey,
        request: input.request,
        requestedBy: input.requestedBy,
        resourceId: input.resourceId,
        serverId: input.serverId,
        serverSnapshot: input.serverSnapshot,
        sourceId: input.sourceId,
        temporalWorkflowId: resourceOperationWorkflowId(id),
        type: input.request.type,
        workspaceId: input.workspaceId,
      })
      .returning(publicOperationSelection);
  } catch (error) {
    if (isUniqueViolation(error)) {
      const [replay] = await getTowbarDatabase()
        .select(publicOperationSelection)
        .from(resourceOperations)
        .where(
          and(
            eq(resourceOperations.workspaceId, input.workspaceId),
            eq(resourceOperations.idempotencyKey, scopedKey),
          ),
        )
        .limit(1);
      if (replay) return { operation: replay, replayed: true };
    }
    throw error;
  }
  if (!created) throw new Error("Unable to create Resource operation");
  try {
    await enqueueResourceOperation({
      appId: input.resourceId,
      buildConcurrency: input.serverSnapshot.buildConcurrency ?? 1,
      exclusive: input.exclusive ?? false,
      operationId: id,
      serverIp: input.serverIp,
    });
  } catch (error) {
    await getTowbarDatabase()
      .update(resourceOperations)
      .set({
        errorCode: "TEMPORAL_UNAVAILABLE",
        errorMessage: "Resource operation queue is unavailable",
        finishedAt: new Date(),
        state: "failed",
        updatedAt: new Date(),
      })
      .where(eq(resourceOperations.id, id));
    if (input.request.type === "backup") {
      await emitResourceOperationNotification(id, "backup.failed").catch(
        () => undefined,
      );
    }
    throw error;
  }
  return { operation: created, replayed: false };
}

function requireDatabaseResource(config: (typeof apps.$inferSelect)["config"]) {
  if (
    !isNormalizedResource(config) ||
    !["postgres", "redis"].includes(config.kind)
  ) {
    throw unprocessable(
      "Backups are supported for PostgreSQL and Redis Resources",
    );
  }
  return config;
}

function requireBackupResource(config: (typeof apps.$inferSelect)["config"]) {
  const resource = requireDatabaseResource(config);
  if (!resource.backup) {
    throw unprocessable(
      "Declare backup.s3 for this Resource before using backups",
    );
  }
  return resource;
}

function isUniqueViolation(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}
