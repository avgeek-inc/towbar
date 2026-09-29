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

export function isServiceDeployment(kind: Deployment["deployableKind"]) {
  return kind === "app" || kind === "compose";
}

export function deploymentDetailTarget(
  deployment: Pick<Deployment, "appId" | "deployableKind">,
  route: { appId?: string; resourceId?: string },
) {
  const service = isServiceDeployment(deployment.deployableKind);
  return {
    kind: service ? ("app" as const) : ("resource" as const),
    queryPath: `/v1/core/${service ? "apps" : "resources"}/${deployment.appId}`,
    belongsToRoute: service
      ? route.appId === deployment.appId && !route.resourceId
      : route.resourceId === deployment.appId && !route.appId,
  };
}

export function deploymentHref(
  deployment: DeploymentRouteTarget,
  section?: string,
) {
  const collection = isServiceDeployment(deployment.deployableKind)
    ? "services"
    : "datastores";
  const destination =
    section ??
    (deployment.state && !terminalStates.has(deployment.state)
      ? "progress"
      : "overview");
  return `/${collection}/${deployment.appId}/deployments/${deployment.id}/${destination}`;
}
