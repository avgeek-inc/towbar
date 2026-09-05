import { and, desc, eq, isNull, max } from "drizzle-orm";
import {
  isNormalizedResource,
  restoreOperationPhaseSchema,
  restoreOperationResultSchema,
} from "@workspace/towbar-core";
import {
  apps,
  auditEvents,
  resourceOperationEvents,
  resourceOperations,
  servers,
} from "@workspace/towbar-database/schema";

import { conflict, notFound, unprocessable } from "../../http/errors.js";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import { cancelResourceOperationWorkflow } from "../../infrastructure/temporal.js";
import { emitResourceOperationNotification } from "../notifications/events.js";
import { hasAwsCredentials } from "../aws/service.js";
import { admitOperation } from "./admission.js";
import { assureResourceBackup } from "./backup-assurance.js";
import {
  getDeployableTarget,
  getResourceBackupAssurance,
  getServerOrphans,
  listOperationEvents,
  listResourceBackupAssurances,
  publicOperationSelection,
} from "./queries.js";

export { getServerOrphans } from "./queries.js";
export { finishResourceOperation } from "./completion.js";
export {
  getOperationExecutionContext,
  resolveOperationSecrets,
} from "./execution.js";
export {
  getResourceBackupAssurance,
  listOperationEvents,
  listResourceBackupAssurances,
};

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
    await requireAwsCredentials(input.workspaceId);
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

export async function requestResourceRestore(input: {
  backupId: string;
  confirmation: string;
  idempotencyKey: string;
  reason: string;
  requestedBy: string;
  resourceId: string;
  workspaceId: string;
}) {
  const target = await getDeployableTarget(input.resourceId, input.workspaceId);
  if (target.archivedAt)
    throw conflict("Archived Resources cannot be restored");
  if (
    !target.serverPreparedAt ||
    target.serverPreparedConfigDigest !== target.serverConfigDigest
  ) {
    throw conflict(
      "Prepare this server before restoring a Resource",
      "SERVER_SETUP_PENDING",
    );
  }
  const resource = requireBackupResource(target.config);
  await requireAwsCredentials(input.workspaceId);
  if (!target.currentRelease) {
    throw unprocessable("Deploy this Resource before restoring a backup");
  }
  if (input.confirmation !== resource.name) {
    throw unprocessable(
      `Type ${resource.name} exactly to confirm this destructive restore`,
      "RESTORE_CONFIRMATION_MISMATCH",
    );
  }
  const assurance = await assureResourceBackup(
    target.id,
    new Date(),
    input.backupId,
  );
  if (!assurance.restoreReady || assurance.backupId !== input.backupId) {
    throw conflict(
      "Only a retained restore-ready backup can be restored",
      "BACKUP_NOT_RESTORE_READY",
    );
  }
  const [backup] = await getTowbarDatabase()
    .select({ id: resourceOperations.id })
    .from(resourceOperations)
    .where(
      and(
        eq(resourceOperations.id, input.backupId),
        eq(resourceOperations.resourceId, target.id),
        eq(resourceOperations.sourceId, target.sourceId),
        eq(resourceOperations.workspaceId, input.workspaceId),
        eq(resourceOperations.type, "backup"),
        eq(resourceOperations.state, "succeeded"),
        isNull(resourceOperations.deletedAt),
      ),
    )
    .limit(1);
  if (!backup) throw notFound("Retained backup");
  const admitted = await admitOperation({
    appSnapshot: resource,
    idempotencyKey: input.idempotencyKey,
    request: {
      backupId: backup.id,
      reason: input.reason,
      release: target.currentRelease,
      type: "restore",
    },
    requestedBy: input.requestedBy,
    resourceId: target.id,
    serverId: target.serverId,
    serverIp: target.serverIp,
    serverSnapshot: target.serverConfig,
    sourceId: target.sourceId,
    workspaceId: input.workspaceId,
  });
  if (!admitted.replayed) {
    await getTowbarDatabase()
      .insert(auditEvents)
      .values({
        action: "resource.restore.requested",
        actorUserId: input.requestedBy,
        metadata: {
          backupId: backup.id,
          operationId: admitted.operation.id,
          reason: input.reason,
        },
        targetId: target.id,
        targetType: "resource",
        workspaceId: input.workspaceId,
      });
    await emitResourceOperationNotification(
      admitted.operation.id,
      "restore.started",
    ).catch(() => undefined);
  }
  return admitted;
}

async function requireAwsCredentials(workspaceId: string) {
  if (!(await hasAwsCredentials(workspaceId))) {
    throw conflict(
      "Configure AWS in Manage → Integrations before running S3 backups or restores",
      "AWS_NOT_CONFIGURED",
    );
  }
}

export async function requestRestoreCleanup(input: {
  idempotencyKey: string;
  requestedBy: string | null;
  resourceId: string;
  restoreId: string;
  workspaceId: string;
}) {
  const target = await getDeployableTarget(input.resourceId, input.workspaceId);
  if (!target.currentRelease) throw unprocessable("Resource is not deployed");
  const [restore] = await getTowbarDatabase()
    .select({ result: resourceOperations.result })
    .from(resourceOperations)
    .where(
      and(
        eq(resourceOperations.id, input.restoreId),
        eq(resourceOperations.resourceId, target.id),
        eq(resourceOperations.workspaceId, input.workspaceId),
        eq(resourceOperations.type, "restore"),
        eq(resourceOperations.state, "succeeded"),
      ),
    )
    .limit(1);
  const result = restoreOperationResultSchema.safeParse(restore?.result);
  if (!result.success || result.data.previousVolumes.length === 0) {
    throw conflict("This restore has no rollback volumes to clean up");
  }
  const scopedKey = `restore_cleanup:${target.id}:${input.idempotencyKey}`;
  const existingCleanups = await getTowbarDatabase()
    .select({
      idempotencyKey: resourceOperations.idempotencyKey,
      request: resourceOperations.request,
      state: resourceOperations.state,
    })
    .from(resourceOperations)
    .where(
      and(
        eq(resourceOperations.resourceId, target.id),
        eq(resourceOperations.workspaceId, input.workspaceId),
        eq(resourceOperations.type, "restore_cleanup"),
      ),
    );
  if (
    existingCleanups.some(
      (cleanup) =>
        cleanup.idempotencyKey !== scopedKey &&
        cleanup.request.type === "restore_cleanup" &&
        cleanup.request.restoreId === input.restoreId &&
        ["queued", "running", "succeeded"].includes(cleanup.state),
    )
  ) {
    throw conflict(
      "This restore's rollback volumes are already being cleaned up",
    );
  }
  const admitted = await admitOperation({
    appSnapshot: target.config,
    idempotencyKey: input.idempotencyKey,
    request: {
      release: target.currentRelease,
      restoreId: input.restoreId,
      type: "restore_cleanup",
      volumes: result.data.previousVolumes.map((volume) => volume.volumeName),
    },
    requestedBy: input.requestedBy,
    resourceId: target.id,
    serverId: target.serverId,
    serverIp: target.serverIp,
    serverSnapshot: target.serverConfig,
    sourceId: target.sourceId,
    workspaceId: input.workspaceId,
  });
  if (!admitted.replayed) {
    await getTowbarDatabase()
      .insert(auditEvents)
      .values({
        action: "resource.restore_cleanup.requested",
        actorUserId: input.requestedBy,
        metadata: {
          operationId: admitted.operation.id,
          restoreId: input.restoreId,
        },
        targetId: target.id,
        targetType: "resource",
        workspaceId: input.workspaceId,
      });
  }
  return admitted;
}

export async function cancelResourceRestore(input: {
  operationId: string;
  requestedBy: string;
  resourceId: string;
  workspaceId: string;
}) {
  const [operation] = await getTowbarDatabase()
    .select(publicOperationSelection)
    .from(resourceOperations)
    .where(
      and(
        eq(resourceOperations.id, input.operationId),
        eq(resourceOperations.resourceId, input.resourceId),
        eq(resourceOperations.workspaceId, input.workspaceId),
        eq(resourceOperations.type, "restore"),
      ),
    )
    .limit(1);
  if (!operation) throw notFound("Restore operation");
  if (!["queued", "running"].includes(operation.state)) {
    throw conflict("This restore can no longer be cancelled");
  }
  if (
    operation.phase &&
    [
      "promoting",
      "verifying_promotion",
      "rolling_back",
      "retaining_previous",
      "succeeded",
      "failed",
      "cancelled",
    ].includes(operation.phase)
  ) {
    throw conflict(
      "Promotion has started; Towbar must finish promotion or rollback",
      "RESTORE_PROMOTION_IN_PROGRESS",
    );
  }
  if (operation.cancelRequestedAt) {
    await cancelResourceOperationWorkflow(operation.id);
    return operation;
  }
  const now = new Date();
  const [updated] = await getTowbarDatabase()
    .update(resourceOperations)
    .set({ cancelRequestedAt: now, updatedAt: now })
    .where(
      and(
        eq(resourceOperations.id, operation.id),
        isNull(resourceOperations.cancelRequestedAt),
      ),
    )
    .returning(publicOperationSelection);
  if (!updated) {
    await cancelResourceOperationWorkflow(operation.id);
    return operation;
  }
  await getTowbarDatabase()
    .insert(auditEvents)
    .values({
      action: "resource.restore.cancel_requested",
      actorUserId: input.requestedBy,
      metadata: { operationId: operation.id },
      targetId: input.resourceId,
      targetType: "resource",
      workspaceId: input.workspaceId,
    });
  await cancelResourceOperationWorkflow(operation.id);
  return updated;
}

export async function appendResourceOperationProgress(
  operationId: string,
  input: {
    command?: string;
    level: "error" | "info" | "success";
    message: string;
    metadata: Record<string, boolean | number | string | null>;
    phase: string;
  },
) {
  const phase = restoreOperationPhaseSchema.parse(input.phase);
  return await getTowbarDatabase().transaction(async (transaction) => {
    const [operation] = await transaction
      .select({ id: resourceOperations.id, type: resourceOperations.type })
      .from(resourceOperations)
      .where(eq(resourceOperations.id, operationId))
      .for("update")
      .limit(1);
    if (!operation || operation.type !== "restore") {
      throw notFound("Restore operation");
    }
    const [latest] = await transaction
      .select({ sequence: max(resourceOperationEvents.sequence) })
      .from(resourceOperationEvents)
      .where(eq(resourceOperationEvents.operationId, operationId));
    const sequence = (latest?.sequence ?? 0) + 1;
    const [event] = await transaction
      .insert(resourceOperationEvents)
      .values({
        command: input.command,
        level: input.level,
        message: input.message,
        metadata: input.metadata,
        operationId,
        phase,
        sequence,
      })
      .returning();
    await transaction
      .update(resourceOperations)
      .set({ phase, updatedAt: new Date() })
      .where(eq(resourceOperations.id, operationId));
    return event;
  });
}

export async function requestOrphanCleanup(input: {
  idempotencyKey: string;
  items: Array<{ kind: "container" | "image" | "volume"; name: string }>;
  requestedBy: string;
  serverId: string;
  workspaceId: string;
}) {
  const [server] = await getTowbarDatabase()
    .select({
      config: servers.config,
      id: servers.id,
      ip: servers.canonicalIp,
    })
    .from(servers)
    .where(
      and(
        eq(servers.id, input.serverId),
        eq(servers.workspaceId, input.workspaceId),
        isNull(servers.archivedAt),
      ),
    )
    .limit(1);
  if (!server) throw notFound("Server");
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
    sourceId: null,
    workspaceId: input.workspaceId,
  });
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
