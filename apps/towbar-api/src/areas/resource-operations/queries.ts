import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";

import {
  backupOperationResultSchema,
  isNormalizedResource,
  orphanItemSchema,
} from "@workspace/towbar-core";
import {
  apps,
  releases,
  resourceBackupAssurances,
  resourceOperationEvents,
  resourceOperations,
  serverChecks,
  serverDeployableOwnership,
  servers,
} from "@workspace/towbar-database/schema";

import { notFound } from "../../http/errors.js";
import { getTowbarDatabase } from "../../infrastructure/database.js";

export const publicOperationSelection = {
  createdAt: resourceOperations.createdAt,
  deletedAt: resourceOperations.deletedAt,
  errorCode: resourceOperations.errorCode,
  errorMessage: resourceOperations.errorMessage,
  finishedAt: resourceOperations.finishedAt,
  id: resourceOperations.id,
  requestedBy: resourceOperations.requestedBy,
  phase: resourceOperations.phase,
  cancelRequestedAt: resourceOperations.cancelRequestedAt,
  request: resourceOperations.request,
  resourceId: resourceOperations.resourceId,
  result: resourceOperations.result,
  serverId: resourceOperations.serverId,
  sourceId: resourceOperations.sourceId,
  startedAt: resourceOperations.startedAt,
  state: resourceOperations.state,
  type: resourceOperations.type,
  updatedAt: resourceOperations.updatedAt,
} as const;

export async function getResourceBackupAssurance(
  resourceId: string,
  workspaceId: string,
) {
  return (
    (await listResourceBackupAssurances(resourceId, workspaceId))[0] ?? null
  );
}

export async function listResourceBackupAssurances(
  resourceId: string,
  workspaceId: string,
) {
  await getDeployableTarget(resourceId, workspaceId);
  return await getTowbarDatabase()
    .select({
      backupOperationId: resourceBackupAssurances.backupOperationId,
      checkedAt: resourceBackupAssurances.checkedAt,
      checks: resourceBackupAssurances.checks,
      resourceId: resourceBackupAssurances.resourceId,
      restoreReady: resourceBackupAssurances.restoreReady,
      status: resourceBackupAssurances.status,
      updatedAt: resourceBackupAssurances.updatedAt,
    })
    .from(resourceBackupAssurances)
    .innerJoin(
      resourceOperations,
      eq(resourceOperations.id, resourceBackupAssurances.backupOperationId),
    )
    .where(eq(resourceBackupAssurances.resourceId, resourceId))
    .orderBy(desc(resourceOperations.createdAt));
}

export async function listOperationEvents(
  operationId: string,
  workspaceId: string,
) {
  const [operation] = await getTowbarDatabase()
    .select({ id: resourceOperations.id })
    .from(resourceOperations)
    .where(
      and(
        eq(resourceOperations.id, operationId),
        eq(resourceOperations.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (!operation) throw notFound("Resource operation");
  return await getTowbarDatabase()
    .select({
      command: resourceOperationEvents.command,
      createdAt: resourceOperationEvents.createdAt,
      id: resourceOperationEvents.id,
      level: resourceOperationEvents.level,
      message: resourceOperationEvents.message,
      metadata: resourceOperationEvents.metadata,
      phase: resourceOperationEvents.phase,
      sequence: resourceOperationEvents.sequence,
    })
    .from(resourceOperationEvents)
    .where(eq(resourceOperationEvents.operationId, operationId))
    .orderBy(resourceOperationEvents.sequence);
}

export async function getDeployableTarget(
  deployableId: string,
  workspaceId: string,
) {
  const [target] = await getTowbarDatabase()
    .select({
      archivedAt: apps.archivedAt,
      config: apps.config,
      currentRelease: {
        containerName: releases.containerName,
        imageTag: releases.imageTag,
        releaseId: releases.id,
      },
      id: apps.id,
      serverConfig: servers.config,
      serverConfigDigest: servers.configDigest,
      serverId: servers.id,
      serverIp: servers.canonicalIp,
      serverPreparedAt: servers.preparedAt,
      serverPreparedConfigDigest: servers.preparedConfigDigest,
      sourceId: apps.sourceId,
    })
    .from(apps)
    .innerJoin(servers, eq(servers.id, apps.serverId))
    .leftJoin(
      releases,
      and(eq(releases.appId, apps.id), eq(releases.status, "current")),
    )
    .where(and(eq(apps.id, deployableId), eq(apps.workspaceId, workspaceId)))
    .limit(1);
  if (!target) throw notFound("Deployable");
  return {
    ...target,
    currentRelease: target.currentRelease?.releaseId
      ? {
          containerName: target.currentRelease.containerName!,
          imageTag: target.currentRelease.imageTag!,
          releaseId: target.currentRelease.releaseId,
        }
      : null,
  };
}

export async function getCleanupExpected(serverId: string) {
  const ownership = await getTowbarDatabase()
    .select({ id: serverDeployableOwnership.deployableId })
    .from(serverDeployableOwnership)
    .where(eq(serverDeployableOwnership.serverId, serverId));
  const deployables = await getTowbarDatabase()
    .select({ id: apps.id })
    .from(apps)
    .where(and(eq(apps.serverId, serverId), isNull(apps.archivedAt)));
  const ids = deployables.map((deployable) => deployable.id);
  const retained = ids.length
    ? await getTowbarDatabase()
        .select({
          containerName: releases.containerName,
          imageTag: releases.imageTag,
          status: releases.status,
        })
        .from(releases)
        .where(
          and(
            inArray(releases.appId, ids),
            inArray(releases.status, ["current", "previous"]),
          ),
        )
    : [];
  return {
    containerNames: retained
      .filter((release) => release.status === "current")
      .map((release) => release.containerName),
    deployableIds: ids,
    ownedDeployableIds: ownership.map((item) => item.id),
    imageTags: retained.map((release) => release.imageTag),
  };
}

export async function getRetentionBackups(
  resourceId: string,
  snapshot: (typeof apps.$inferSelect)["config"] | null,
) {
  if (!snapshot || !isNormalizedResource(snapshot) || !snapshot.backup) {
    return [];
  }
  const keepPrevious = Math.max(0, snapshot.backup.retention.keepLast - 1);
  const backups = await getTowbarDatabase()
    .select({
      id: resourceOperations.id,
      result: resourceOperations.result,
    })
    .from(resourceOperations)
    .where(
      and(
        eq(resourceOperations.resourceId, resourceId),
        eq(resourceOperations.type, "backup"),
        eq(resourceOperations.state, "succeeded"),
        isNull(resourceOperations.deletedAt),
      ),
    )
    .orderBy(desc(resourceOperations.createdAt));
  return backups.slice(keepPrevious).map((backup) => {
    const result = backupOperationResultSchema.parse(backup.result);
    return { bucket: result.bucket, id: backup.id, key: result.key };
  });
}

export async function getServerOrphans(serverId: string, workspaceId: string) {
  const [server] = await getTowbarDatabase()
    .select({ id: servers.id })
    .from(servers)
    .where(and(eq(servers.id, serverId), eq(servers.workspaceId, workspaceId)))
    .limit(1);
  if (!server) throw notFound("Server");
  const [latest] = await getTowbarDatabase()
    .select({ result: serverChecks.result })
    .from(serverChecks)
    .where(
      and(
        eq(serverChecks.serverId, server.id),
        eq(serverChecks.status, "succeeded"),
      ),
    )
    .orderBy(desc(serverChecks.finishedAt))
    .limit(1);
  return z.array(orphanItemSchema).parse(latest?.result?.orphans ?? []);
}
