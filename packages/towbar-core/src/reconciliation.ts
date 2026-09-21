import {
  type NormalizedApp,
  type NormalizedComposeWorkload,
  type NormalizedDeploymentManifest,
  type NormalizedResource,
  digestValue,
} from "./manifest.js";

export type MaterializedManifestEntity<T> = {
  archivedAt: Date | null;
  config: T;
  configDigest: string;
  id: string;
  identity: string;
};

export type ReconciliationAction<T> = {
  action: "archive" | "create" | "restore" | "unchanged" | "update";
  current?: MaterializedManifestEntity<T>;
  desired?: T;
  id: string;
};

export type ManifestReconciliation = {
  apps: Array<ReconciliationAction<NormalizedApp>>;
  compose: Array<ReconciliationAction<NormalizedComposeWorkload>>;
  resources: Array<ReconciliationAction<NormalizedResource>>;
  summary: Record<ReconciliationAction<unknown>["action"], number>;
};

export function reconcileManifest(input: {
  currentApps: Array<MaterializedManifestEntity<NormalizedApp>>;
  currentCompose?: Array<MaterializedManifestEntity<NormalizedComposeWorkload>>;
  currentResources?: Array<MaterializedManifestEntity<NormalizedResource>>;
  desired: NormalizedDeploymentManifest;
}): ManifestReconciliation {
  const apps = reconcileEntities(
    input.currentApps,
    input.desired.apps,
    (app) => app.id,
  );
  const resources = reconcileEntities(
    input.currentResources ?? [],
    input.desired.resources ?? [],
    (resource) => resource.id,
  );
  const compose = reconcileEntities(
    input.currentCompose ?? [],
    input.desired.compose ?? [],
    (workload) => workload.id,
  );
  const summary: ManifestReconciliation["summary"] = {
    archive: 0,
    create: 0,
    restore: 0,
    unchanged: 0,
    update: 0,
  };
  [...apps, ...compose, ...resources].forEach((entry) => {
    summary[entry.action] += 1;
  });
  return { apps, compose, resources, summary };
}

function reconcileEntities<T>(
  current: Array<MaterializedManifestEntity<T>>,
  desired: T[],
  identity: (value: T) => string,
): Array<ReconciliationAction<T>> {
  const currentById = new Map(current.map((entry) => [entry.identity, entry]));
  const actions: Array<ReconciliationAction<T>> = [];

  for (const desiredEntity of desired) {
    const id = identity(desiredEntity);
    const currentEntity = currentById.get(id);
    currentById.delete(id);
    if (!currentEntity) {
      actions.push({ action: "create", desired: desiredEntity, id });
      continue;
    }
    if (currentEntity.archivedAt) {
      actions.push({
        action: "restore",
        current: currentEntity,
        desired: desiredEntity,
        id,
      });
      continue;
    }
    if (currentEntity.configDigest !== digestValue(desiredEntity)) {
      actions.push({
        action: "update",
        current: currentEntity,
        desired: desiredEntity,
        id,
      });
      continue;
    }
    actions.push({
      action: "unchanged",
      current: currentEntity,
      desired: desiredEntity,
      id,
    });
  }

  for (const [id, currentEntity] of currentById) {
    if (!currentEntity.archivedAt) {
      actions.push({ action: "archive", current: currentEntity, id });
    }
  }

  return actions.sort((left, right) => left.id.localeCompare(right.id));
}
