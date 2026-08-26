import { desc, eq, inArray } from "drizzle-orm";

import type { TowbarDatabase } from "@workspace/towbar-database";
import { serverChecks } from "@workspace/towbar-database/schema";

export const SERVER_CHECK_RETENTION_LIMIT = 500;

type ServerCheckRetentionCandidate = {
  id: string;
  status: "failed" | "queued" | "running" | "succeeded";
};

const terminalStatuses = new Set<ServerCheckRetentionCandidate["status"]>([
  "failed",
  "succeeded",
]);

export function serverCheckIdsToPrune(
  checks: ServerCheckRetentionCandidate[],
  limit = SERVER_CHECK_RETENTION_LIMIT,
) {
  return checks
    .slice(limit)
    .filter((check) => terminalStatuses.has(check.status))
    .map((check) => check.id);
}

export async function pruneServerCheckHistory(
  database: Pick<TowbarDatabase, "delete" | "select">,
  serverId: string,
) {
  const checks = await database
    .select({ id: serverChecks.id, status: serverChecks.status })
    .from(serverChecks)
    .where(eq(serverChecks.serverId, serverId))
    .orderBy(desc(serverChecks.createdAt), desc(serverChecks.id));
  const ids = serverCheckIdsToPrune(checks);
  if (ids.length === 0) return 0;
  await database.delete(serverChecks).where(inArray(serverChecks.id, ids));
  return ids.length;
}
