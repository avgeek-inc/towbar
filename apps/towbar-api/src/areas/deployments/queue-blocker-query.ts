import { and, eq, inArray } from "drizzle-orm";

import {
  resourceOperations,
  serverChecks,
  serverPreparations,
} from "@workspace/towbar-database/schema";

import { getTowbarDatabase } from "../../infrastructure/database.js";
import {
  type ServerQueueBarrier,
  resolveDeploymentQueueBlocker,
} from "./queue-blocker.js";

export async function attachDeploymentQueueBlockers<
  T extends { createdAt: Date; serverId: string; state: string },
>(items: T[]) {
  const queuedServerIds = [
    ...new Set(
      items
        .filter((item) => item.state === "queued")
        .map((item) => item.serverId),
    ),
  ];
  if (queuedServerIds.length === 0) {
    return items.map((item) => ({ ...item, queueBlocker: null }));
  }

  const database = getTowbarDatabase();
  const [checks, preparations, operations] = await Promise.all([
    database
      .select({
        createdAt: serverChecks.createdAt,
        serverId: serverChecks.serverId,
      })
      .from(serverChecks)
      .where(
        and(
          inArray(serverChecks.serverId, queuedServerIds),
          inArray(serverChecks.status, ["queued", "running"]),
        ),
      ),
    database
      .select({
        createdAt: serverPreparations.createdAt,
        serverId: serverPreparations.serverId,
      })
      .from(serverPreparations)
      .where(
        and(
          inArray(serverPreparations.serverId, queuedServerIds),
          inArray(serverPreparations.status, ["queued", "running"]),
        ),
      ),
    database
      .select({
        createdAt: resourceOperations.createdAt,
        serverId: resourceOperations.serverId,
      })
      .from(resourceOperations)
      .where(
        and(
          inArray(resourceOperations.serverId, queuedServerIds),
          inArray(resourceOperations.state, ["queued", "running"]),
          eq(resourceOperations.type, "cleanup_orphans"),
        ),
      ),
  ]);
  const barriers: ServerQueueBarrier[] = [
    ...checks.map((check) => ({ ...check, type: "server_check" as const })),
    ...preparations.map((preparation) => ({
      ...preparation,
      type: "server_preparation" as const,
    })),
    ...operations.map((operation) => ({
      ...operation,
      type: "server_operation" as const,
    })),
  ];
  return items.map((item) => ({
    ...item,
    queueBlocker: resolveDeploymentQueueBlocker({
      barriers,
      deployment: item,
    }),
  }));
}
