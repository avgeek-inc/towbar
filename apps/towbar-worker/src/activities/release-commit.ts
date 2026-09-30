import { releaseCommitSchema } from "@workspace/towbar-core";

import type { DeploymentResult } from "@workspace/towbar-deployer";

export function releaseCommitPayload(result: DeploymentResult) {
  return releaseCommitSchema.parse({
    ...(result.composeServices?.length
      ? { composeServices: result.composeServices }
      : {}),
    containerName: result.containerName,
    containerNames: result.containerNames,
    imageDigest: result.imageDigest,
    imagePlatform: result.imagePlatform,
    imageTag: result.imageTag,
  });
}
