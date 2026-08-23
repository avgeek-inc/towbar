import type { DeploymentExecutionContext } from "./types.js";
import { isNormalizedResource } from "@workspace/towbar-core";

export function deploymentRemoteIdentity(context: DeploymentExecutionContext) {
  return {
    containerName: `towbar-${context.app.id}-${isNormalizedResource(context.app) ? `${context.deployableId.slice(0, 8)}-` : ""}${context.deploymentId.slice(0, 8)}`,
    imageTag: `towbar/deployable-${context.deployableId}:${context.commitSha.slice(0, 12)}-${context.deploymentId.slice(0, 8)}`,
    remoteDirectory: `/tmp/towbar-${context.deploymentId}`,
  };
}

export function deploymentCleanupId(context: DeploymentExecutionContext) {
  return isNormalizedResource(context.app)
    ? context.deployableId
    : context.app.id;
}
