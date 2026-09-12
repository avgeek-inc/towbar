import { conflict } from "../../http/errors.js";
import { and, eq } from "drizzle-orm";
import { apps, servers } from "@workspace/towbar-database/schema";
import type { SecretDatabase } from "../secrets/store.js";

export async function lockRollbackInstance(
  transaction: SecretDatabase,
  appId: string,
  workspaceId: string,
) {
  const [current] = await transaction
    .select({
      archivedAt: apps.archivedAt,
      configDigest: apps.configDigest,
      deploymentDigest: apps.deploymentDigest,
      serverId: apps.serverId,
      serverConfigDigest: servers.configDigest,
      serverPreparedAt: servers.preparedAt,
      serverPreparedConfigDigest: servers.preparedConfigDigest,
    })
    .from(apps)
    .innerJoin(servers, eq(servers.id, apps.serverId))
    .where(and(eq(apps.id, appId), eq(apps.workspaceId, workspaceId)))
    .for("update");
  return current;
}

export function requireServerReady(target: {
  serverConfigDigest: string;
  serverPreparedAt: Date | null;
  serverPreparedConfigDigest: string | null;
}) {
  if (
    !target.serverPreparedAt ||
    target.serverPreparedConfigDigest !== target.serverConfigDigest
  ) {
    throw conflict(
      "Prepare this server before deploying apps or resources",
      "SERVER_SETUP_PENDING",
    );
  }
}
