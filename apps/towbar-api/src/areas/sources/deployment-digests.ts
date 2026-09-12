import {
  ManifestValidationError,
  getDeployableDeploymentDigest,
  getSourceInputDigest,
  isNormalizedResource,
} from "@workspace/towbar-core";

import type {
  NormalizedDeployable,
  NormalizedServer,
  RepositoryTree,
} from "@workspace/towbar-core";

export type MaterializedDeploymentDigest = {
  deploymentDigest: string;
  sourceInputDigest: string | null;
};

export function calculateReleaseDeploymentDigest(input: {
  commitSha: string;
  deployable: NormalizedDeployable;
  deploymentInputs: string[];
  repositoryTree?: RepositoryTree;
  server: NormalizedServer;
}): MaterializedDeploymentDigest {
  const sourceInputDigest = isNormalizedResource(input.deployable)
    ? null
    : getSourceInputDigest({
        commitSha: input.commitSha,
        deploymentInputs: input.deploymentInputs,
        tree: input.repositoryTree,
      }).digest;
  return {
    deploymentDigest: getDeployableDeploymentDigest({
      deployable: input.deployable,
      server: input.server,
      sourceInputDigest,
    }),
    sourceInputDigest,
  };
}

export function calculateDesiredDeploymentDigest(input: {
  commitSha: string;
  deployable: NormalizedDeployable;
  repositoryTree?: RepositoryTree;
  server: NormalizedServer;
}) {
  if (isNormalizedResource(input.deployable)) {
    return {
      id: input.deployable.id,
      ...calculateReleaseDeploymentDigest({
        ...input,
        deploymentInputs: [],
      }),
    };
  }
  const source = getSourceInputDigest({
    commitSha: input.commitSha,
    deploymentInputs: input.deployable.deploymentInputs,
    tree: input.repositoryTree,
  });
  if (
    input.deployable.deploymentInputs.length > 0 &&
    !source.fallback &&
    source.matchedPaths.length === 0
  ) {
    throw new ManifestValidationError([
      {
        message: `App '${input.deployable.id}' deployment inputs do not match any repository files`,
        path: ["apps", input.deployable.id, "autoDeploy", "inputs"],
      },
    ]);
  }
  return {
    deploymentDigest: getDeployableDeploymentDigest({
      deployable: input.deployable,
      server: input.server,
      sourceInputDigest: source.digest,
    }),
    id: input.deployable.id,
    sourceInputDigest: source.digest,
  };
}
