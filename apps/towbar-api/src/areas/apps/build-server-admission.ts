import { and, eq, isNull } from "drizzle-orm";
import {
  isNormalizedCompose,
  isNormalizedResource,
} from "@workspace/towbar-core";
import { servers } from "@workspace/towbar-database/schema";
import { conflict } from "../../http/errors.js";
import type { AuthDatabase } from "../../infrastructure/database.js";
import type { NormalizedDeployable } from "@workspace/towbar-core";

export async function resolveBuildServerAdmission(
  database: AuthDatabase,
  input: {
    deployable: NormalizedDeployable;
    runtimeServerId: string;
    workspaceId: string;
  },
) {
  if (
    isNormalizedResource(input.deployable) ||
    isNormalizedCompose(input.deployable) ||
    !input.deployable.buildServer
  )
    return null;
  const selection = input.deployable.buildServer;
  const [server] = await database
    .select({
      config: servers.config,
      configDigest: servers.configDigest,
      id: servers.id,
      preparedAt: servers.preparedAt,
      preparedConfigDigest: servers.preparedConfigDigest,
      privateKeyId: servers.privateKeyId,
    })
    .from(servers)
    .where(
      and(
        eq(servers.workspaceId, input.workspaceId),
        eq(servers.canonicalIp, selection.ip),
        isNull(servers.archivedAt),
      ),
    )
    .for("update")
    .limit(1);
  if (!server) {
    if (selection.allowRuntimeFallback) return null;
    throw conflict(
      "The selected build server is not registered in this team",
      "BUILD_SERVER_NOT_REGISTERED",
    );
  }
  if (
    !server.privateKeyId ||
    !server.preparedAt ||
    server.preparedConfigDigest !== server.configDigest
  ) {
    if (selection.allowRuntimeFallback) return null;
    throw conflict(
      "The selected build server must have trusted credentials and be fully prepared",
      "BUILD_SERVER_NOT_READY",
    );
  }
  if (server.id === input.runtimeServerId) return null;
  return {
    id: server.id,
    snapshot: server.config,
    transfer: selection.transfer,
  };
}
