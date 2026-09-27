export type DeploymentSubscription = {
  deployments: boolean;
  deploymentFailures: boolean;
};

export function hasOneDeploymentSubscription(row: DeploymentSubscription) {
  return !(row.deployments && row.deploymentFailures);
}

export function deploymentSubscriptionCategories(row: DeploymentSubscription) {
  if (row.deployments) return ["deployments" as const];
  if (row.deploymentFailures) return ["deploymentFailures" as const];
  return [];
}
