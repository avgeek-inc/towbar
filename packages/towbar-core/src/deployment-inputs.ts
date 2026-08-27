import { minimatch } from "minimatch";

import { digestValue } from "./manifest-values.js";

import type { NormalizedDeployable, NormalizedServer } from "./manifest.js";

export type RepositoryTreeEntry = {
  mode: string;
  path: string;
  sha: string;
  type: "blob" | "commit";
};

export type RepositoryTree = {
  complete: boolean;
  entries: RepositoryTreeEntry[];
};

export function selectDeploymentInputEntries(
  inputs: string[],
  tree: RepositoryTree,
) {
  if (!tree.complete) return [];
  return tree.entries
    .filter((entry) =>
      inputs.some((input) =>
        minimatch(entry.path, input, {
          dot: true,
          nocomment: true,
          nonegate: true,
          nocase: false,
        }),
      ),
    )
    .sort((left, right) => left.path.localeCompare(right.path));
}

export function getSourceInputDigest(input: {
  commitSha: string;
  deploymentInputs: string[];
  tree?: RepositoryTree;
}) {
  if (input.deploymentInputs.length === 0 || !input.tree?.complete) {
    return {
      digest: digestValue({ commitSha: input.commitSha, mode: "commit" }),
      fallback: true,
      matchedPaths: [] as string[],
    };
  }
  const selected = selectDeploymentInputEntries(
    input.deploymentInputs,
    input.tree,
  );
  return {
    digest: digestValue({
      entries: selected.map(({ mode, path, sha, type }) => ({
        mode,
        path,
        sha,
        type,
      })),
      mode: "paths",
    }),
    fallback: false,
    matchedPaths: selected.map((entry) => entry.path),
  };
}

export function getDeployableDeploymentDigest(input: {
  deployable: NormalizedDeployable;
  server: NormalizedServer;
  sourceInputDigest: string | null;
}) {
  const server = { ...input.server } as Record<string, unknown>;
  delete server.buildConcurrency;
  delete server.previewBuildConcurrency;
  return digestValue({
    runtimeConfig: getDeploymentRuntimeConfig(input.deployable),
    server,
    sourceInputDigest: input.sourceInputDigest,
  });
}

function getDeploymentRuntimeConfig(deployable: NormalizedDeployable) {
  const value = { ...deployable } as Record<string, unknown>;
  delete value.autoDeploy;
  // Ignore the scheduling field retained by deployments admitted before
  // dependency support was removed from the manifest contract.
  delete value.dependsOn;
  delete value.description;
  delete value.deploymentInputs;
  delete value.name;
  delete value.preview;
  delete value.sourceBranch;
  return value;
}
