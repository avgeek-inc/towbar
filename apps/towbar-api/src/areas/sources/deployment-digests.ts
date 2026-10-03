import {
  ManifestValidationError,
  getDeployableDeploymentDigest,
  getSourceInputDigest,
  isNormalizedCompose,
  isNormalizedResource,
  normalizeRepositoryPath,
  validateConfigurationSources,
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
  validateComposeSource(input);
  const files = isNormalizedCompose(input.deployable)
    ? []
    : (input.deployable.container.configFiles ?? []);
  const sourceInputDigest =
    isNormalizedResource(input.deployable) && !files.length
      ? null
      : getSourceInputDigest({
          commitSha: input.commitSha,
          deploymentInputs: isNormalizedResource(input.deployable)
            ? files.map((file) => file.source)
            : input.deploymentInputs.length
              ? [
                  ...new Set([
                    ...input.deploymentInputs,
                    ...files.map((file) => file.source),
                  ]),
                ]
              : [],
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
  validateComposeSource(input);
  if (
    !isNormalizedCompose(input.deployable) &&
    input.deployable.container.configFiles?.length
  ) {
    if (!input.repositoryTree)
      throw new Error("Configuration files require the source snapshot tree");
    validateConfigurationSources(
      input.deployable.container.configFiles,
      input.repositoryTree,
    );
  }
  if (isNormalizedResource(input.deployable)) {
    return {
      id: input.deployable.id,
      ...calculateReleaseDeploymentDigest({
        ...input,
        deploymentInputs: [],
      }),
    };
  }
  const deploymentInputs = input.deployable.deploymentInputs;
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

function validateComposeSource(input: {
  deployable: NormalizedDeployable;
  repositoryTree?: RepositoryTree;
}) {
  if (!isNormalizedCompose(input.deployable)) return;
  if (!input.repositoryTree?.complete)
    throw new ManifestValidationError([
      {
        message: "Compose change detection requires a complete repository tree",
        path: ["compose", input.deployable.id, "file"],
      },
    ]);
  for (const file of [input.deployable.file, ...input.deployable.overrides]) {
    const entry = input.repositoryTree.entries.find(
      (entry) => entry.path === normalizeRepositoryPath(file),
    );
    if (
      !entry ||
      entry.type !== "blob" ||
      !["100644", "100755"].includes(entry.mode)
    )
      throw new ManifestValidationError([
        {
          message: `Compose file '${file}' must be a regular file in the selected revision`,
          path: [
            "compose",
            input.deployable.id,
            file === input.deployable.file ? "file" : "overrides",
          ],
        },
      ]);
  }
}
