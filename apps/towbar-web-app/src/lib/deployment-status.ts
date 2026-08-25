import type { Deployment, DeploymentState } from "@workspace/towbar-web-client";

export function getDeploymentDisplayStatus(
  deployment: Pick<Deployment, "queueBlocker" | "state">,
): DeploymentState | string {
  if (deployment.state !== "queued") return deployment.state;
  switch (deployment.queueBlocker) {
    case "server_check":
      return "waiting_for_server_check";
    case "server_preparation":
      return "waiting_for_server_preparation";
    case "server_operation":
      return "waiting_for_server_operation";
    case "server_capacity":
      return "waiting_for_server_capacity";
    default:
      return deployment.state;
  }
}
