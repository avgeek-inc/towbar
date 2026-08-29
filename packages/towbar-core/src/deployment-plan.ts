import { getMatchingChangedPaths } from "./deployment-inputs.js";
import { reconcileManifest } from "./reconciliation.js";

import type {
  DeploymentPlan,
  DeploymentPlanAction,
  DeploymentPlanCheck,
  DeploymentPlanEntityKind,
  DeploymentPlanItem,
  DeploymentPlanSummary,
  MaterializedDeploymentPlanEntity,
} from "./deployment-plan.types.js";
import type { RepositoryChangedPaths } from "./deployment-inputs.js";
import type {
  NormalizedApp,
  NormalizedDeployable,
  NormalizedDeploymentManifest,
  NormalizedResource,
  NormalizedServer,
} from "./manifest.js";
import type { ReconciliationAction } from "./reconciliation.js";

export type {
  DeploymentPlan,
  DeploymentPlanAction,
  DeploymentPlanCheck,
  DeploymentPlanCheckStatus,
  DeploymentPlanEntityKind,
  DeploymentPlanItem,
  DeploymentPlanStatus,
  DeploymentPlanSummary,
  MaterializedDeploymentPlanEntity,
} from "./deployment-plan.types.js";

export function buildDeploymentPlan(input: {
  checks?: DeploymentPlanCheck[];
  currentApps: Array<MaterializedDeploymentPlanEntity<NormalizedApp>>;
  currentResources: Array<MaterializedDeploymentPlanEntity<NormalizedResource>>;
  currentServers: Array<MaterializedDeploymentPlanEntity<NormalizedServer>>;
  desired: NormalizedDeploymentManifest;
  mode: "full" | "pull_request";
  repositoryChanges?: RepositoryChangedPaths;
  targetDeploymentDigests: Map<string, string>;
}): DeploymentPlan {
  const reconciliation = reconcileManifest({
    currentApps: input.currentApps,
    currentResources: input.currentResources,
    currentServers: input.currentServers,
    desired: input.desired,
  });
  const items = [
    ...reconciliation.apps.map((action) =>
      planDeployableAction({
        action,
        current: input.currentApps,
        entityKind: "app",
        repositoryChanges: input.repositoryChanges,
        targetDeploymentDigests: input.targetDeploymentDigests,
      }),
    ),
    ...reconciliation.resources.map((action) =>
      planDeployableAction({
        action,
        current: input.currentResources,
        entityKind: "resource",
        repositoryChanges: input.repositoryChanges,
        targetDeploymentDigests: input.targetDeploymentDigests,
      }),
    ),
    ...reconciliation.servers.map((action) =>
      planServerAction(action, input.currentServers),
    ),
  ]
    .filter(
      (item) =>
        input.mode === "full" ||
        item.action !== "no_op" ||
        item.matchedPaths.length > 0,
    )
    .sort(comparePlanItems);
  const checks = [...(input.checks ?? [])].sort(comparePlanChecks);
  return {
    checks,
    items,
    status: checks.some((check) => check.status === "failed")
      ? "blocked"
      : "ready",
    summary: summarizePlanItems(items),
  };
}

export function buildBlockedDeploymentPlan(
  checks: DeploymentPlanCheck[],
): DeploymentPlan {
  const ordered = [...checks].sort(comparePlanChecks);
  return {
    checks: ordered,
    items: [],
    status: "blocked",
    summary: emptyPlanSummary(),
  };
}

export function changedFieldPaths(left: unknown, right: unknown) {
  const paths: string[] = [];
  visitChangedFields(left, right, "", paths);
  return paths.sort((first, second) => first.localeCompare(second));
}

function planDeployableAction<T extends NormalizedDeployable>(input: {
  action: ReconciliationAction<T>;
  current: Array<MaterializedDeploymentPlanEntity<T>>;
  entityKind: "app" | "resource";
  repositoryChanges?: RepositoryChangedPaths;
  targetDeploymentDigests: Map<string, string>;
}): DeploymentPlanItem {
  const current = input.current.find(
    (candidate) => candidate.identity === input.action.id,
  );
  const desired = input.action.desired;
  const name = desired?.name ?? current?.config.name ?? input.action.id;
  const deploymentInputs =
    input.entityKind === "app" && desired && "deploymentInputs" in desired
      ? desired.deploymentInputs
      : [];
  const matchedPaths =
    input.entityKind === "app" && desired && input.repositoryChanges
      ? getMatchingChangedPaths({
          changedPaths: input.repositoryChanges,
          deploymentInputs,
        })
      : [];
  const changedFields =
    input.action.current && desired
      ? changedFieldPaths(input.action.current.config, desired)
      : [];
  const automaticDeployment = desired?.autoDeploy ?? false;

  if (input.action.action !== "unchanged") {
    return {
      action: input.action.action,
      automaticDeployment,
      changedFields,
      entityId: input.action.id,
      entityKind: input.entityKind,
      matchedPaths,
      name,
      reasons: reconciliationReasons(input.action.action, changedFields),
    };
  }

  const targetDigest = input.targetDeploymentDigests.get(input.action.id);
  const deploymentInputChanged =
    targetDigest !== undefined && targetDigest !== current?.deploymentDigest;
  if (deploymentInputChanged && automaticDeployment) {
    return {
      action: "update",
      automaticDeployment,
      changedFields: [],
      entityId: input.action.id,
      entityKind: input.entityKind,
      matchedPaths,
      name,
      reasons: [
        matchedPaths.length > 0
          ? "Changed paths match this deployable's deployment inputs"
          : "The effective deployment input digest changed",
      ],
    };
  }

  return {
    action: "no_op",
    automaticDeployment,
    changedFields: [],
    entityId: input.action.id,
    entityKind: input.entityKind,
    matchedPaths,
    name,
    reasons: [
      deploymentInputChanged
        ? "Deployment inputs changed, but automatic deployment is disabled"
        : "Configuration and deployment inputs are unchanged",
    ],
  };
}

function planServerAction(
  action: ReconciliationAction<NormalizedServer>,
  currentServers: Array<MaterializedDeploymentPlanEntity<NormalizedServer>>,
): DeploymentPlanItem {
  const current = currentServers.find(
    (candidate) => candidate.identity === action.id,
  );
  const changedFields =
    action.current && action.desired
      ? changedFieldPaths(action.current.config, action.desired)
      : [];
  const planAction = normalizeAction(action.action);
  return {
    action: planAction,
    automaticDeployment: false,
    changedFields,
    entityId: action.id,
    entityKind: "server",
    matchedPaths: [],
    name: action.desired?.ip ?? current?.config.ip ?? action.id,
    reasons:
      planAction === "no_op"
        ? ["Server configuration is unchanged"]
        : reconciliationReasons(planAction, changedFields),
  };
}

function reconciliationReasons(
  action: Exclude<DeploymentPlanAction, "no_op">,
  changedFields: string[],
) {
  switch (action) {
    case "archive":
      return ["The entity is absent from the candidate manifest"];
    case "create":
      return ["The entity is not present in the active Source inventory"];
    case "restore":
      return ["The entity reappears after being archived"];
    case "update":
      return [
        changedFields.length > 0
          ? `Configuration changed in ${changedFields.join(", ")}`
          : "The effective deployment input digest changed",
      ];
  }
}

function normalizeAction(
  action: ReconciliationAction<unknown>["action"],
): DeploymentPlanAction {
  return action === "unchanged" ? "no_op" : action;
}

function summarizePlanItems(items: DeploymentPlanItem[]) {
  const summary = emptyPlanSummary();
  for (const item of items) summary[item.action] += 1;
  return summary;
}

function emptyPlanSummary(): DeploymentPlanSummary {
  return { archive: 0, create: 0, no_op: 0, restore: 0, update: 0 };
}

function comparePlanItems(left: DeploymentPlanItem, right: DeploymentPlanItem) {
  return (
    entityKindOrder(left.entityKind) - entityKindOrder(right.entityKind) ||
    left.entityId.localeCompare(right.entityId)
  );
}

function entityKindOrder(kind: DeploymentPlanEntityKind) {
  return kind === "app" ? 0 : kind === "resource" ? 1 : 2;
}

function comparePlanChecks(
  left: DeploymentPlanCheck,
  right: DeploymentPlanCheck,
) {
  return (
    checkStatusOrder(left.status) - checkStatusOrder(right.status) ||
    left.code.localeCompare(right.code) ||
    (left.entityId ?? "").localeCompare(right.entityId ?? "") ||
    left.message.localeCompare(right.message)
  );
}

function checkStatusOrder(status: DeploymentPlanCheck["status"]) {
  return status === "failed" ? 0 : status === "warning" ? 1 : 2;
}

function visitChangedFields(
  left: unknown,
  right: unknown,
  path: string,
  paths: string[],
) {
  if (Object.is(left, right)) return;
  if (Array.isArray(left) && Array.isArray(right)) {
    if (JSON.stringify(left) !== JSON.stringify(right)) {
      paths.push(path || "value");
    }
    return;
  }
  if (isRecord(left) && isRecord(right)) {
    const keys = [
      ...new Set([...Object.keys(left), ...Object.keys(right)]),
    ].sort((first, second) => first.localeCompare(second));
    for (const key of keys) {
      visitChangedFields(
        left[key],
        right[key],
        path ? `${path}.${key}` : key,
        paths,
      );
    }
    return;
  }
  paths.push(path || "value");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
