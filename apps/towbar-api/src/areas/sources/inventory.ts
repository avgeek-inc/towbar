import { eq } from "drizzle-orm";

import { apps, servers } from "@workspace/towbar-database/schema";

import { conflict } from "../../http/errors.js";
import { getTowbarDatabase } from "../../infrastructure/database.js";

import type {
  MaterializedDeploymentPlanEntity,
  NormalizedApp,
  NormalizedDeploymentManifest,
  NormalizedResource,
  NormalizedServer,
} from "@workspace/towbar-core";

export async function loadCurrentInventory(sourceId: string) {
  const database = getTowbarDatabase();
  const currentApps = await database
    .select({
      archivedAt: apps.archivedAt,
      config: apps.config,
      configDigest: apps.configDigest,
      deploymentDigest: apps.deploymentDigest,
      id: apps.id,
      identity: apps.manifestId,
    })
    .from(apps)
    .where(eq(apps.sourceId, sourceId));
  const currentServers = await database
    .select({
      archivedAt: servers.archivedAt,
      config: servers.config,
      configDigest: servers.configDigest,
      id: servers.id,
      identity: servers.canonicalIp,
    })
    .from(servers)
    .where(eq(servers.sourceId, sourceId));
  return {
    apps: currentApps.filter(
      (app) => app.config.kind === "app" || !app.config.kind,
    ) as Array<MaterializedDeploymentPlanEntity<NormalizedApp>>,
    resources: currentApps.filter(
      (app) => app.config.kind && app.config.kind !== "app",
    ) as Array<MaterializedDeploymentPlanEntity<NormalizedResource>>,
    servers: currentServers as Array<
      MaterializedDeploymentPlanEntity<NormalizedServer>
    >,
  };
}

export function assertStableDeployableKinds(
  current: Awaited<ReturnType<typeof loadCurrentInventory>>,
  desired: NormalizedDeploymentManifest,
) {
  const currentAppIds = new Set(current.apps.map((app) => app.identity));
  const currentResourceIds = new Set(
    current.resources.map((resource) => resource.identity),
  );
  const changedId =
    desired.apps.find((app) => currentResourceIds.has(app.id))?.id ??
    desired.resources?.find((resource) => currentAppIds.has(resource.id))?.id;
  if (changedId) {
    throw conflict(
      `Deployable '${changedId}' cannot change between App and Resource`,
      "DEPLOYABLE_KIND_CHANGE",
    );
  }
}
