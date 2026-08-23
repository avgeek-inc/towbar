import { and, eq, isNull } from "drizzle-orm";

import {
  ManifestValidationError,
  getDeployableDeploymentDigest,
  getSourceInputDigest,
  isNormalizedResource,
} from "@workspace/towbar-core";
import { apps, deployments, releases } from "@workspace/towbar-database/schema";

import { getTowbarDatabase } from "../../infrastructure/database.js";
import { fetchGitHubRepositoryTree } from "../github/client.js";

import type {
  NormalizedDeployable,
  NormalizedDeploymentManifest,
  NormalizedServer,
  RepositoryTree,
} from "@workspace/towbar-core";

export type MaterializedDeploymentDigest = {
  deploymentDigest: string;
  sourceInputDigest: string | null;
};

type GitHubRepository = {
  installationId: string;
  repositoryName: string;
  repositoryOwner: string;
};

export async function fetchRepositoryTreeForDeploymentInputs(input: {
  commitSha: string;
  manifestApps: Array<{ deploymentInputs: string[] }>;
  repository: GitHubRepository;
}) {
  if (!input.manifestApps.some((app) => app.deploymentInputs.length > 0)) {
    return undefined;
  }
  return await fetchGitHubRepositoryTree({
    ...input.repository,
    commitSha: input.commitSha,
  });
}

export async function calculateLegacyReleaseDigests(input: {
  commitSha: string;
  manifest: NormalizedDeploymentManifest;
  repository: GitHubRepository;
  repositoryTree?: RepositoryTree;
  sourceId: string;
}) {
  const rows = await getTowbarDatabase()
    .select({
      appSnapshot: deployments.appSnapshot,
      commitSha: releases.commitSha,
      deploymentDigest: releases.deploymentDigest,
      manifestId: apps.manifestId,
      releaseId: releases.id,
      serverSnapshot: deployments.serverSnapshot,
    })
    .from(releases)
    .innerJoin(apps, eq(apps.id, releases.appId))
    .innerJoin(deployments, eq(deployments.id, releases.deploymentId))
    .where(
      and(
        eq(apps.sourceId, input.sourceId),
        eq(releases.status, "current"),
        isNull(releases.deploymentDigest),
      ),
    );
  const desiredById = new Map(
    [...input.manifest.apps, ...(input.manifest.resources ?? [])].map(
      (deployable) => [deployable.id, deployable],
    ),
  );
  const treeByCommit = new Map<string, RepositoryTree | undefined>([
    [input.commitSha, input.repositoryTree],
  ]);
  const result = new Map<string, MaterializedDeploymentDigest>();
  for (const row of rows) {
    if (row.deploymentDigest) continue;
    const desired = desiredById.get(row.manifestId);
    if (!desired) continue;
    const deploymentInputs =
      "deploymentInputs" in desired ? desired.deploymentInputs : [];
    let historicalTree = treeByCommit.get(row.commitSha);
    if (deploymentInputs.length > 0 && !treeByCommit.has(row.commitSha)) {
      try {
        historicalTree = await fetchGitHubRepositoryTree({
          ...input.repository,
          commitSha: row.commitSha,
        });
      } catch {
        // A force-pushed legacy commit may no longer be available. Falling
        // back to its commit identity safely causes one replacement deploy.
        historicalTree = { complete: false, entries: [] };
      }
      treeByCommit.set(row.commitSha, historicalTree);
    }
    result.set(
      row.releaseId,
      calculateReleaseDeploymentDigest({
        commitSha: row.commitSha,
        deployable: row.appSnapshot,
        deploymentInputs,
        repositoryTree: historicalTree,
        server: row.serverSnapshot,
      }),
    );
  }
  return result;
}

export function calculateDesiredDeploymentDigests(input: {
  commitSha: string;
  manifest: NormalizedDeploymentManifest;
  repositoryTree?: RepositoryTree;
}) {
  const serverByIp = new Map(
    input.manifest.servers.map((server) => [server.ip, server]),
  );
  return new Map(
    [
      ...input.manifest.apps.map((deployable) =>
        calculateDesiredDeploymentDigest({
          commitSha: input.commitSha,
          deployable,
          repositoryTree: input.repositoryTree,
          server: requireServer(serverByIp, deployable.server),
        }),
      ),
      ...(input.manifest.resources ?? []).map((deployable) =>
        calculateDesiredDeploymentDigest({
          commitSha: input.commitSha,
          deployable,
          repositoryTree: input.repositoryTree,
          server: requireServer(serverByIp, deployable.server),
        }),
      ),
    ].map(({ id, ...digest }) => [id, digest]),
  );
}

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

function calculateDesiredDeploymentDigest(input: {
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

function requireServer(serverByIp: Map<string, NormalizedServer>, ip: string) {
  const server = serverByIp.get(ip);
  if (!server) throw new Error(`Server '${ip}' was not normalized`);
  return server;
}
