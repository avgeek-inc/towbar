import { and, desc, eq, isNull, ne } from "drizzle-orm";

import {
  getLatestBackupScheduleOccurrence,
  isNormalizedResource,
} from "@workspace/towbar-core";
import { apps, serverChecks, servers } from "@workspace/towbar-database/schema";

import { getTowbarDatabase } from "../../infrastructure/database.js";
import { requestServerCheck } from "../servers/service.js";
import { requestDeployableOperation } from "./service.js";

export async function runMaintenanceSweep() {
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
      !latest ||
      (!["queued", "running"].includes(latest.status) &&
        Date.now() - latest.createdAt.getTime() >= 5 * 60_000)
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
  return { backupsQueued, checksQueued };
}
