import { and, desc, eq, inArray, isNull, ne, notInArray } from "drizzle-orm";

import {
  getLatestBackupScheduleOccurrence,
  isNormalizedResource,
} from "@workspace/towbar-core";
import { terminalDeploymentStates } from "@workspace/towbar-core/temporal";
import type { CheckStatus } from "@workspace/towbar-database/schema";
import {
  apps,
  deployments,
  resourceOperations,
  serverChecks,
  serverPreparations,
  servers,
} from "@workspace/towbar-database/schema";

import { getTowbarDatabase } from "../../infrastructure/database.js";
import { requestServerCheck } from "../servers/service.js";
import { requestExpiredPreviewCleanups } from "../previews/cleanup.js";
import { requestDeployableOperation } from "./service.js";

export async function runMaintenanceSweep() {
  // Scheduled deployable work has priority; health checks are maintenance and
  // should enter a server coordinator only after its queue becomes idle.
  const backupsQueued = await queueScheduledBackups();
  const previewCleanupsQueued = await requestExpiredPreviewCleanups();
  const activeServers = await getTowbarDatabase()
    .select({
      id: servers.id,
      sourceId: servers.sourceId,
      workspaceId: servers.workspaceId,
    })
    .from(servers)
    .where(isNull(servers.archivedAt));
  let checksQueued = 0;
  for (const server of activeServers) {
    const [latest] = await getTowbarDatabase()
      .select({
        createdAt: serverChecks.createdAt,
        status: serverChecks.status,
      })
      .from(serverChecks)
      .where(eq(serverChecks.serverId, server.id))
      .orderBy(desc(serverChecks.createdAt))
      .limit(1);
    if (
      shouldQueueMaintenanceServerCheck({
        hasPendingServerWork: await hasPendingServerWork(server.id),
        latestCheck: latest,
        now: new Date(),
      })
    ) {
      const queued = await requestServerCheck({
        requestedBy: null,
        serverId: server.id,
        sourceId: server.sourceId,
        workspaceId: server.workspaceId,
      }).catch(() => undefined);
      if (queued) checksQueued += 1;
    }
  }

  return { backupsQueued, checksQueued, previewCleanupsQueued };
}

async function queueScheduledBackups() {
  const resources = await getTowbarDatabase()
    .select({ id: apps.id, config: apps.config, workspaceId: apps.workspaceId })
    .from(apps)
    .where(and(ne(apps.kind, "app"), isNull(apps.archivedAt)));
  let backupsQueued = 0;
  const now = new Date();
  for (const resource of resources) {
    if (!isNormalizedResource(resource.config)) continue;
    const schedule = resource.config.backup?.schedule;
    if (!schedule) continue;
    const occurrence = getLatestBackupScheduleOccurrence(schedule.cron, now);
    if (!occurrence) continue;
    await requestDeployableOperation({
      deployableId: resource.id,
      idempotencyKey: `scheduled-backup:${resource.id}:${occurrence.toISOString()}`,
      requestedBy: null,
      request: { type: "backup" },
      workspaceId: resource.workspaceId,
    })
      .then((result) => {
        if (!result.replayed) backupsQueued += 1;
      })
      .catch(() => undefined);
  }
  return backupsQueued;
}

async function hasPendingServerWork(serverId: string) {
  const database = getTowbarDatabase();
  const [activeDeployments, activeOperations, activePreparations] =
    await Promise.all([
      database
        .select({ id: deployments.id })
        .from(deployments)
        .where(
          and(
            eq(deployments.serverId, serverId),
            notInArray(deployments.state, [...terminalDeploymentStates]),
          ),
        )
        .limit(1),
      database
        .select({ id: resourceOperations.id })
        .from(resourceOperations)
        .where(
          and(
            eq(resourceOperations.serverId, serverId),
            inArray(resourceOperations.state, ["queued", "running"]),
          ),
        )
        .limit(1),
      database
        .select({ id: serverPreparations.id })
        .from(serverPreparations)
        .where(
          and(
            eq(serverPreparations.serverId, serverId),
            inArray(serverPreparations.status, ["queued", "running"]),
          ),
        )
        .limit(1),
    ]);
  return Boolean(
    activeDeployments[0] || activeOperations[0] || activePreparations[0],
  );
}

export function shouldQueueMaintenanceServerCheck(input: {
  hasPendingServerWork: boolean;
  latestCheck: { createdAt: Date; status: CheckStatus } | undefined;
  now: Date;
}) {
  if (input.hasPendingServerWork) return false;
  if (!input.latestCheck) return true;
  if (["queued", "running"].includes(input.latestCheck.status)) return false;
  return (
    input.now.getTime() - input.latestCheck.createdAt.getTime() >= 5 * 60_000
  );
}
