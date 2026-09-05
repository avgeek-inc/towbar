import { and, eq, isNull, ne } from "drizzle-orm";

import {
  apps,
  deployments,
  previewEnvironments,
  resourceOperations,
  servers,
  sources,
} from "@workspace/towbar-database/schema";

import { getTowbarDatabase } from "../../infrastructure/database.js";
import {
  backupFailedNotificationCopy,
  backupNotRestorableNotificationCopy,
  backupStaleNotificationCopy,
} from "./backup-notifications.js";
import { emitNotificationEvent, notificationEventPayload } from "./service.js";

import type {
  NotificationEventPayload,
  NotificationEventType,
} from "@workspace/towbar-core";

export async function emitDeploymentNotification(
  deploymentId: string,
  type:
    | "deployment.queued"
    | "deployment.started"
    | "deployment.succeeded"
    | "deployment.failed"
    | "deployment.cancelled",
) {
  const [deployment] = await getTowbarDatabase()
    .select({
      appName: apps.name,
      commitSha: deployments.commitSha,
      environment: deployments.environment,
      errorCode: deployments.errorCode,
      errorMessage: deployments.errorMessage,
      id: deployments.id,
      repositoryName: sources.repositoryName,
      sourceId: deployments.sourceId,
      workspaceId: deployments.workspaceId,
    })
    .from(deployments)
    .innerJoin(apps, eq(apps.id, deployments.appId))
    .innerJoin(sources, eq(sources.id, deployments.sourceId))
    .where(eq(deployments.id, deploymentId))
    .limit(1);
  if (!deployment) return;
  const status = type.slice("deployment.".length).replaceAll("_", " ");
  await emitNotificationEvent({
    dedupeKey: `${type}:${deployment.id}`,
    payload: notificationEventPayload({
      details: {
        commit: deployment.commitSha.slice(0, 12),
        environment: deployment.environment,
        errorCode: deployment.errorCode,
      },
      entity: {
        id: deployment.id,
        kind: "deployment",
        name: deployment.appName,
      },
      message:
        deployment.errorMessage ??
        `${deployment.appName} deployment is ${status}.`,
      source: {
        id: deployment.sourceId,
        name: deployment.repositoryName,
      },
      title: `Deployment ${status}`,
    }),
    sourceId: deployment.sourceId,
    type,
    workspaceId: deployment.workspaceId,
  });
}

export async function emitPreviewNotification(
  previewEnvironmentId: string,
  type:
    | "preview.ready"
    | "preview.failed"
    | "preview.superseded"
    | "preview.cleaned_up",
) {
  const [preview] = await getTowbarDatabase()
    .select({
      appName: apps.name,
      branch: previewEnvironments.branch,
      errorMessage: previewEnvironments.errorMessage,
      hostname: previewEnvironments.hostname,
      id: previewEnvironments.id,
      pullRequestNumber: previewEnvironments.pullRequestNumber,
      repositoryName: sources.repositoryName,
      sourceId: previewEnvironments.sourceId,
      updatedAt: previewEnvironments.updatedAt,
      workspaceId: previewEnvironments.workspaceId,
    })
    .from(previewEnvironments)
    .innerJoin(apps, eq(apps.id, previewEnvironments.appId))
    .innerJoin(sources, eq(sources.id, previewEnvironments.sourceId))
    .where(eq(previewEnvironments.id, previewEnvironmentId))
    .limit(1);
  if (!preview) return;
  const status = type.slice("preview.".length).replaceAll("_", " ");
  await emitNotificationEvent({
    dedupeKey: `${type}:${preview.id}:${preview.updatedAt.toISOString()}`,
    payload: notificationEventPayload({
      details: {
        branch: preview.branch,
        hostname: preview.hostname,
        pullRequest: preview.pullRequestNumber,
      },
      entity: {
        id: preview.id,
        kind: "preview",
        name: `${preview.appName} · PR #${preview.pullRequestNumber}`,
      },
      message:
        preview.errorMessage ?? `${preview.appName} Preview is ${status}.`,
      source: { id: preview.sourceId, name: preview.repositoryName },
      title: `Preview ${status}`,
    }),
    sourceId: preview.sourceId,
    type,
    workspaceId: preview.workspaceId,
  });
}

export async function emitResourceOperationNotification(
  operationId: string,
  type:
    | "backup.failed"
    | "restore.started"
    | "restore.succeeded"
    | "restore.cancelled"
    | "restore.failed"
    | "restore.rolled_back",
) {
  const [operation] = await getTowbarDatabase()
    .select({
      errorCode: resourceOperations.errorCode,
      errorMessage: resourceOperations.errorMessage,
      id: resourceOperations.id,
      repositoryName: sources.repositoryName,
      resourceId: resourceOperations.resourceId,
      resourceName: apps.name,
      sourceId: resourceOperations.sourceId,
      workspaceId: resourceOperations.workspaceId,
    })
    .from(resourceOperations)
    .innerJoin(sources, eq(sources.id, resourceOperations.sourceId))
    .leftJoin(apps, eq(apps.id, resourceOperations.resourceId))
    .where(eq(resourceOperations.id, operationId))
    .limit(1);
  if (!operation?.sourceId) return;
  const status = type.replace(".", " ").replaceAll("_", " ");
  const backupCopy =
    type === "backup.failed"
      ? backupFailedNotificationCopy(
          operation.resourceName ?? "database resource",
        )
      : null;
  await emitNotificationEvent({
    dedupeKey: `${type}:${operation.id}`,
    payload: notificationEventPayload({
      details: backupCopy ? {} : { errorCode: operation.errorCode },
      entity: {
        id: operation.resourceId ?? operation.id,
        kind: type.startsWith("backup") ? "backup" : "restore",
        name: operation.resourceName ?? "Database Resource",
      },
      message:
        backupCopy?.message ??
        operation.errorMessage ??
        `${operation.resourceName ?? "Database Resource"} ${status}.`,
      source: {
        id: operation.sourceId,
        name: operation.repositoryName,
      },
      title: backupCopy?.title ?? capitalize(status),
    }),
    sourceId: operation.sourceId,
    type,
    workspaceId: operation.workspaceId,
  });
}

export async function emitRuntimeHealthNotification(input: {
  checkId: string;
  entityId: string;
  entityKind: "resource" | "server";
  recovered: boolean;
}) {
  const type = input.recovered
    ? ("runtime.recovered" as const)
    : ("runtime.unhealthy" as const);
  if (input.entityKind === "server") {
    const [server] = await getTowbarDatabase()
      .select({
        entityName: servers.canonicalIp,
        workspaceId: servers.workspaceId,
      })
      .from(servers)
      .where(eq(servers.id, input.entityId))
      .limit(1);
    if (!server) return;
    const sourceTargets = await getTowbarDatabase()
      .selectDistinct({
        repositoryName: sources.repositoryName,
        sourceId: sources.id,
      })
      .from(apps)
      .innerJoin(sources, eq(sources.id, apps.sourceId))
      .where(
        and(
          eq(apps.serverId, input.entityId),
          isNull(apps.archivedAt),
          isNull(sources.archivedAt),
        ),
      );
    await Promise.all(
      sourceTargets.map((target) =>
        emitRuntimeHealthEvent({
          ...input,
          entityName: server.entityName,
          repositoryName: target.repositoryName,
          sourceId: target.sourceId,
          type,
          workspaceId: server.workspaceId,
        }),
      ),
    );
    return;
  }
  const [resource] = await getTowbarDatabase()
    .select({
      entityName: apps.name,
      repositoryName: sources.repositoryName,
      sourceId: apps.sourceId,
      workspaceId: apps.workspaceId,
    })
    .from(apps)
    .innerJoin(sources, eq(sources.id, apps.sourceId))
    .where(and(eq(apps.id, input.entityId), ne(apps.kind, "app")))
    .limit(1);
  if (!resource) return;
  await emitRuntimeHealthEvent({
    ...input,
    ...resource,
    type,
  });
}

async function emitRuntimeHealthEvent(input: {
  checkId: string;
  entityId: string;
  entityKind: "resource" | "server";
  entityName: string;
  recovered: boolean;
  repositoryName: string;
  sourceId: string;
  type: "runtime.recovered" | "runtime.unhealthy";
  workspaceId: string;
}) {
  await emitNotificationEvent({
    dedupeKey: `${input.type}:${input.entityKind}:${input.entityId}:${input.sourceId}:${input.checkId}`,
    payload: notificationEventPayload({
      entity: {
        id: input.entityId,
        kind: input.entityKind,
        name: input.entityName,
      },
      message: input.recovered
        ? `${input.entityName} recovered and is healthy again.`
        : `${input.entityName} is unhealthy and needs attention.`,
      source: { id: input.sourceId, name: input.repositoryName },
      title: input.recovered ? "Runtime recovered" : "Runtime unhealthy",
    }),
    sourceId: input.sourceId,
    type: input.type,
    workspaceId: input.workspaceId,
  });
}

export async function emitServerCheckNotifications(input: {
  checkId: string;
  runtimeTransitions: Array<{ deployableId: string; recovered: boolean }>;
  serverBecameUnhealthy: boolean;
  serverId: string;
  serverRecovered: boolean;
}) {
  const notifications: Array<Promise<void>> = [];
  if (input.serverBecameUnhealthy || input.serverRecovered) {
    notifications.push(
      emitRuntimeHealthNotification({
        checkId: input.checkId,
        entityId: input.serverId,
        entityKind: "server",
        recovered: input.serverRecovered,
      }),
    );
  }
  notifications.push(
    ...input.runtimeTransitions.map((transition) =>
      emitRuntimeHealthNotification({
        checkId: input.checkId,
        entityId: transition.deployableId,
        entityKind: "resource",
        recovered: transition.recovered,
      }),
    ),
  );
  await Promise.all(
    notifications.map((promise) => promise.catch(() => undefined)),
  );
}

export async function emitBackupStaleNotification(input: {
  occurrence: Date;
  resourceId: string;
}) {
  const [resource] = await getTowbarDatabase()
    .select({
      name: apps.name,
      repositoryName: sources.repositoryName,
      sourceId: apps.sourceId,
      workspaceId: apps.workspaceId,
    })
    .from(apps)
    .innerJoin(sources, eq(sources.id, apps.sourceId))
    .where(eq(apps.id, input.resourceId))
    .limit(1);
  if (!resource) return;
  const copy = backupStaleNotificationCopy(resource.name, input.occurrence);
  await emitNotificationEvent({
    dedupeKey: `backup.stale:${input.resourceId}:${input.occurrence.toISOString()}`,
    payload: notificationEventPayload({
      details: copy.details,
      entity: {
        id: input.resourceId,
        kind: "resource",
        name: resource.name,
      },
      message: copy.message,
      source: { id: resource.sourceId, name: resource.repositoryName },
      title: copy.title,
    }),
    sourceId: resource.sourceId,
    type: "backup.stale",
    workspaceId: resource.workspaceId,
  });
}

export async function emitBackupAssuranceNotification(input: {
  backupId: string | null;
  checkedAt: Date;
  resourceId: string;
}) {
  const [resource] = await getTowbarDatabase()
    .select({
      name: apps.name,
      repositoryName: sources.repositoryName,
      sourceId: apps.sourceId,
      workspaceId: apps.workspaceId,
    })
    .from(apps)
    .innerJoin(sources, eq(sources.id, apps.sourceId))
    .where(eq(apps.id, input.resourceId))
    .limit(1);
  if (!resource) return;
  const copy = backupNotRestorableNotificationCopy(resource.name);
  await emitNotificationEvent({
    dedupeKey: `backup.not_restorable:${input.resourceId}:${input.backupId ?? "missing"}:${input.checkedAt.toISOString()}`,
    payload: notificationEventPayload({
      details: {},
      entity: {
        id: input.resourceId,
        kind: "resource",
        name: resource.name,
      },
      message: copy.message,
      source: { id: resource.sourceId, name: resource.repositoryName },
      title: copy.title,
    }),
    sourceId: resource.sourceId,
    type: "backup.not_restorable",
    workspaceId: resource.workspaceId,
  });
}

function capitalize(value: string) {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

export type EmitNotification = (
  dedupeKey: string,
  payload: NotificationEventPayload,
  type: NotificationEventType,
) => Promise<void>;
