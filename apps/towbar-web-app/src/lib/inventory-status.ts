import type {
  Deployment,
  DeploymentState,
  RuntimeState,
} from "@workspace/towbar-web-client";

const terminalDeploymentStates = new Set<DeploymentState>([
  "cancelled",
  "failed",
  "skipped",
  "succeeded",
  "succeeded_with_warnings",
]);

export function getActiveDeploymentStates(deployments: Deployment[]) {
  const activeStates = new Map<string, DeploymentState>();
  const newestFirst = [...deployments].sort(
    (left, right) =>
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );

  for (const deployment of newestFirst) {
    if (
      !activeStates.has(deployment.appId) &&
      !terminalDeploymentStates.has(deployment.state)
    ) {
      activeStates.set(deployment.appId, deployment.state);
    }
  }

  return activeStates;
}

export function resolveInventorySyncStatus(
  driftStatus: RuntimeState["driftStatus"],
  activeDeploymentState?: DeploymentState,
) {
  return activeDeploymentState ?? driftStatus;
}

export function resolveInventoryStatus({
  activeDeploymentState,
  archived,
  healthStatus,
  serverReady,
}: {
  activeDeploymentState?: DeploymentState;
  archived: boolean;
  healthStatus: RuntimeState["healthStatus"];
  serverReady: boolean;
}) {
  if (archived) return "archived";
  if (!serverReady) return "server_setup_pending";
  return activeDeploymentState ?? healthStatus;
}
