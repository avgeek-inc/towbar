import type {
  NormalizedApp,
  NormalizedResource,
  NormalizedServer,
} from "./manifest.js";
import type { MaterializedManifestEntity } from "./reconciliation.js";

export type DeploymentPlanAction =
  "archive" | "create" | "no_op" | "restore" | "update";
export type DeploymentPlanEntityKind = "app" | "resource" | "server";
export type DeploymentPlanCheckStatus = "failed" | "passed" | "warning";
export type DeploymentPlanStatus = "blocked" | "ready";

export type DeploymentPlanItem = {
  action: DeploymentPlanAction;
  automaticDeployment: boolean;
  changedFields: string[];
  entityId: string;
  entityKind: DeploymentPlanEntityKind;
  matchedPaths: string[];
  name: string;
  reasons: string[];
};

export type DeploymentPlanCheck = {
  code: string;
  entityId?: string;
  entityKind?: DeploymentPlanEntityKind | "source";
  message: string;
  references?: string[];
  status: DeploymentPlanCheckStatus;
};

export type DeploymentPlanSummary = Record<DeploymentPlanAction, number>;

export type DeploymentPlan = {
  checks: DeploymentPlanCheck[];
  items: DeploymentPlanItem[];
  status: DeploymentPlanStatus;
  summary: DeploymentPlanSummary;
};

export type MaterializedDeploymentPlanEntity<
  T extends NormalizedApp | NormalizedResource | NormalizedServer,
> = MaterializedManifestEntity<T> & {
  deploymentDigest?: string | null;
};
