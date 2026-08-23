import type { DeploymentResult } from "@workspace/towbar-deployer";

export function releaseCommitPayload(result: DeploymentResult) {
  return {
    containerName: result.containerName,
    imageTag: result.imageTag,
  };
}
