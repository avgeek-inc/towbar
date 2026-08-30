import type { DeploymentResult } from "@workspace/towbar-deployer";

export function releaseCommitPayload(result: DeploymentResult) {
  return {
    containerName: result.containerName,
    imageDigest: result.imageDigest,
    imagePlatform: result.imagePlatform,
    imageTag: result.imageTag,
  };
}
