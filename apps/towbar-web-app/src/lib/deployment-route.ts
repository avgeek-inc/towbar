import type { Deployment } from "@workspace/towbar-web-client";

type DeploymentRouteTarget = Pick<
  Deployment,
  "appId" | "deployableKind" | "id"
>;

export function deploymentHref(
  deployment: DeploymentRouteTarget,
  section?: string,
) {
  const collection = deployment.deployableKind === "app" ? "apps" : "resources";
  return `/${collection}/${deployment.appId}/deployments/${deployment.id}${section ? `/${section}` : ""}`;
}
