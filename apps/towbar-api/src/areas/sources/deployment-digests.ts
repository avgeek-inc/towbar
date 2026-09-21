import {
  ManifestValidationError,
  getDeployableDeploymentDigest,
  getSourceInputDigest,
  isNormalizedCompose,
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
  const deploymentInputs = isNormalizedCompose(input.deployable)
    ? [input.deployable.file, ...input.deployable.overrides]
    : input.deployable.deploymentInputs;
  const source = getSourceInputDigest({
    commitSha: input.commitSha,
    deploymentInputs,
    tree: input.repositoryTree,
  });
  if (
    deploymentInputs.length > 0 &&
    !source.fallback &&
    source.matchedPaths.length === 0
  ) {
    throw new ManifestValidationError([
      {
        message: `${isNormalizedCompose(input.deployable) ? "Compose workload" : "App"} '${input.deployable.id}' deployment inputs do not match any repository files`,
        path: [
          isNormalizedCompose(input.deployable) ? "compose" : "apps",
          input.deployable.id,
          isNormalizedCompose(input.deployable) ? "file" : "autoDeploy",
        ],
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
