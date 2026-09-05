import { and, eq, inArray, isNull } from "drizzle-orm";

import { servers } from "@workspace/towbar-database/schema";

import { conflict } from "../../http/errors.js";
import { getTowbarDatabase } from "../../infrastructure/database.js";

import type { NormalizedDeploymentManifest } from "@workspace/towbar-core";

export function referencedServerIps(manifest: NormalizedDeploymentManifest) {
  return [
    ...new Set(
      [...manifest.apps, ...(manifest.resources ?? [])].map(
        (deployable) => deployable.server,
      ),
    ),
  ].sort();
}

export async function resolveWorkspaceServers(
  workspaceId: string,
  manifest: NormalizedDeploymentManifest,
) {
  const ips = referencedServerIps(manifest);
  const rows = await getTowbarDatabase()
    .select({
      config: servers.config,
      configDigest: servers.configDigest,
      id: servers.id,
      ip: servers.canonicalIp,
      preparedAt: servers.preparedAt,
      preparedConfigDigest: servers.preparedConfigDigest,
    })
    .from(servers)
    .where(
      and(
        eq(servers.workspaceId, workspaceId),
        isNull(servers.archivedAt),
        inArray(servers.canonicalIp, ips),
      ),
    );
  const found = new Set(rows.map((server) => server.ip));
  const missing = ips.filter((ip) => !found.has(ip));
  if (missing.length > 0) {
    throw conflict(
      `Configure ${missing.map((ip) => `server '${ip}'`).join(", ")} in Towbar under Servers before syncing this Source`,
      "SERVER_NOT_CONFIGURED",
    );
  }
  return rows;
}
