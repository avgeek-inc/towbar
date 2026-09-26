import type { Deployment } from "@workspace/towbar-web-client";

type DeploymentRouteTarget = Pick<
  Deployment,
  "appId" | "deployableKind" | "id"
> &
  Partial<Pick<Deployment, "state">>;

const terminalStates = new Set<Deployment["state"]>([
  "cancelled",
  "failed",
  "skipped",
  "succeeded",
  "succeeded_with_warnings",
]);

export function deploymentHref(
  deployment: DeploymentRouteTarget,
  section?: string,
) {
  const collection =
    deployment.deployableKind === "app" ||
    deployment.deployableKind === "compose"
      ? "services"
      : "datastores";
  const destination =
    section ??
    (deployment.state && !terminalStates.has(deployment.state)
      ? "progress"
      : "overview");
  return `/${collection}/${deployment.appId}/deployments/${deployment.id}/${destination}`;
}
