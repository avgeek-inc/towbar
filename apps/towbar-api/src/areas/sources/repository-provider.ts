import { fetchGitHubEnvironmentSnapshot } from "../github/environment-snapshot.js";
import { fetchGitLabEnvironmentSnapshot } from "../gitlab/environment-snapshot.js";
import {
  fetchGitLabMergeRequest,
  fetchGitLabMergeRequestChangedPaths,
  listGitLabRepositoryBranches,
  listOpenGitLabMergeRequestNumbers,
} from "../gitlab/client.js";
import {
  fetchGitHubPullRequest,
  fetchGitHubPullRequestChangedPaths,
  fetchGitHubRepositoryTree,
  listOpenGitHubPullRequestNumbers,
} from "../github/client.js";
import { listRepositoryBranches as listGitHubRepositoryBranches } from "../github/branches.js";
import { resolveIntegrationById } from "../integrations/service.js";
import { and, eq } from "drizzle-orm";
import {
  integrationInstallations,
  sources,
} from "@workspace/towbar-database/schema";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import { notFound } from "../../http/errors.js";

export type RepositoryConnection =
  | {
      provider: "github";
      installationId: string;
      repositoryName: string;
      repositoryOwner: string;
    }
  | {
      provider: "gitlab";
      connectionId: string;
      projectId: string;
      repositoryName: string;
      repositoryOwner: string;
      workspaceId: string;
    };

export async function fetchRepositoryEnvironmentSnapshot(
  input: RepositoryConnection &
    (
      | { branch: string; commitSha?: never }
      | { branch?: never; commitSha: string }
    ),
) {
  return input.provider === "github"
    ? fetchGitHubEnvironmentSnapshot(input)
    : fetchGitLabEnvironmentSnapshot(input);
}

export async function repositoryProviderClient(
  connection: RepositoryConnection,
) {
  if (connection.provider === "github") return connection;
  const resolved = await resolveIntegrationById({
    id: connection.connectionId,
    providers: ["gitlab"],
    target: { kind: "workspace", purpose: "source" },
    workspaceId: connection.workspaceId,
  });
  if (resolved.connectionInput.provider !== "gitlab")
    throw new Error("GitLab source resolved an incompatible integration");
  return { ...connection, connection: resolved.connectionInput };
}

export async function sourceProviderClient(sourceId: string) {
  const [source] = await getTowbarDatabase()
    .select({
      connectionId: sources.integrationAuthorizationId,
      projectId: sources.providerRepositoryId,
      installationId: integrationInstallations.externalId,
      provider: sources.provider,
      repositoryName: sources.repositoryName,
      repositoryOwner: sources.repositoryOwner,
      workspaceId: sources.workspaceId,
    })
    .from(sources)
    .leftJoin(
      integrationInstallations,
      eq(integrationInstallations.id, sources.integrationInstallationId),
    )
    .where(and(eq(sources.id, sourceId), eq(sources.status, "active")))
    .limit(1);
  if (!source) throw notFound("Repository");
  return repositoryProviderClient(
    source.provider === "github"
      ? source.installationId
        ? {
            installationId: source.installationId,
            provider: "github",
            repositoryName: source.repositoryName,
            repositoryOwner: source.repositoryOwner,
          }
        : (() => {
            throw new Error("GitHub source is missing its installation");
          })()
      : source.connectionId && source.projectId
        ? {
            connectionId: source.connectionId,
            projectId: source.projectId,
            provider: "gitlab",
            repositoryName: source.repositoryName,
            repositoryOwner: source.repositoryOwner,
            workspaceId: source.workspaceId,
          }
        : (() => {
            throw new Error("GitLab source is missing its integration");
          })(),
  );
}

export async function fetchRepositoryPullRequest(
  connection: Awaited<ReturnType<typeof repositoryProviderClient>>,
  pullRequestNumber: number,
) {
  return connection.provider === "github"
    ? fetchGitHubPullRequest({ ...connection, pullRequestNumber })
    : fetchGitLabMergeRequest({
        ...connection,
        connection: connection.connection,
        pullRequestNumber,
      });
}

export async function fetchRepositoryPullRequestChangedPaths(
  connection: Awaited<ReturnType<typeof repositoryProviderClient>>,
  input: { changedFileCount: number; pullRequestNumber: number },
) {
  return connection.provider === "github"
    ? fetchGitHubPullRequestChangedPaths({ ...connection, ...input })
    : fetchGitLabMergeRequestChangedPaths({
        ...connection,
        ...input,
        connection: connection.connection,
      });
}

export async function fetchRepositoryTree(
  connection: Awaited<ReturnType<typeof repositoryProviderClient>>,
  commitSha: string,
) {
  if (connection.provider === "github")
    return fetchGitHubRepositoryTree({ ...connection, commitSha });
  const snapshot = await fetchGitLabEnvironmentSnapshot({
    ...connection,
    commitSha,
  });
  return snapshot.repositoryTree;
}

export async function listOpenRepositoryPullRequestNumbers(
  connection: Awaited<ReturnType<typeof repositoryProviderClient>>,
  baseBranch: string,
) {
  return connection.provider === "github"
    ? listOpenGitHubPullRequestNumbers({ ...connection, baseBranch })
    : listOpenGitLabMergeRequestNumbers({
        ...connection,
        baseBranch,
        connection: connection.connection,
      });
}

export async function listRepositoryBranches(
  connection: Awaited<ReturnType<typeof repositoryProviderClient>>,
) {
  return connection.provider === "github"
    ? listGitHubRepositoryBranches({
        installationId: connection.installationId,
        owner: connection.repositoryOwner,
        repository: connection.repositoryName,
      })
    : listGitLabRepositoryBranches({
        connection: connection.connection,
        repositoryName: connection.repositoryName,
        repositoryOwner: connection.repositoryOwner,
      });
}
