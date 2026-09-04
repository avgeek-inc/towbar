import { eq } from "drizzle-orm";

import { apps } from "@workspace/towbar-database/schema";

import { conflict } from "../../http/errors.js";
import { getTowbarDatabase } from "../../infrastructure/database.js";

import type {
  MaterializedManifestEntity,
  NormalizedApp,
  NormalizedDeploymentManifest,
  NormalizedResource,
} from "@workspace/towbar-core";

export async function loadCurrentInventory(sourceId: string) {
  const database = getTowbarDatabase();
  const currentApps = await database
    .select({
      archivedAt: apps.archivedAt,
      config: apps.config,
      configDigest: apps.configDigest,
      id: apps.id,
      identity: apps.manifestId,
    })
    .from(apps)
    .where(eq(apps.sourceId, sourceId));
  return {
    apps: currentApps.filter(
      (app) => app.config.kind === "app" || !app.config.kind,
    ) as Array<MaterializedManifestEntity<NormalizedApp>>,
    resources: currentApps.filter(
      (app) => app.config.kind && app.config.kind !== "app",
    ) as Array<MaterializedManifestEntity<NormalizedResource>>,
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
