import { and, eq, isNull } from "drizzle-orm";

import { servers } from "@workspace/towbar-database/schema";

import { notFound } from "../../http/errors.js";
import { getTowbarDatabase } from "../../infrastructure/database.js";

export async function getServerPrivateKeyId(
  serverId: string,
  workspaceId: string,
) {
  const [server] = await getTowbarDatabase()
    .select({ privateKeyId: servers.privateKeyId })
    .from(servers)
    .where(
      and(
        eq(servers.id, serverId),
        eq(servers.workspaceId, workspaceId),
        isNull(servers.archivedAt),
      ),
    )
    .limit(1);
  if (!server) throw notFound("Server");
  return server.privateKeyId;
}
