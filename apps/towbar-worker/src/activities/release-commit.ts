import type { DeploymentResult } from "@workspace/towbar-deployer";

export function releaseCommitPayload(result: DeploymentResult) {
  return {
    ...(result.composeServices?.length
      ? { composeServices: result.composeServices }
      : {}),
    containerName: result.containerName,
    containerNames: result.containerNames,
    imageDigest: result.imageDigest,
    imagePlatform: result.imagePlatform,
    imageTag: result.imageTag,
  };
}
