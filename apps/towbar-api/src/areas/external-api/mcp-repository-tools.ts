import { z } from "zod";
import {
  type McpTool,
  action,
  id,
  page,
  pageItems,
  records,
  sourceId,
  tool,
} from "./mcp-toolkit.js";

export const repositoryTools: McpTool[] = [
  action(
    "source_change_github_connection",
    "Change repository GitHub connection",
    "Update an existing source after its GitHub repository transfers or changes name. The destination must be the same repository and expose all configured branches. Preserves history and settings without deploying; sync afterward. Find the destination connection ID with towbar_repository_search.",
    "POST",
    "/sources/:sourceId/actions/change-github-connection",
    sourceId,
    { destructive: false },
  ),
  tool(
    "repository_search",
    "Find available GitHub or GitLab repositories",
    "Find a repository connection and provider-specific identifier for towbar_source_connect. GitHub returns a githubInstallationId for each repository and supports an optional connectionId account filter; GitLab uses its workspace provider configuration and supports cloud or self-managed instances.",
    z
      .object({
        provider: z.enum(["github", "gitlab"]).default("github"),
        integration: z.string().trim().min(1).max(80).optional(),
        connectionId: id("GitHub connection").optional(),
        search: z.string().max(255).default(""),
        ...page,
      })
      .strict()
      .refine(
        (a) =>
          a.provider === "gitlab"
            ? Boolean(a.integration) && !a.connectionId
            : !a.integration,
        "integration is required for GitLab and must be omitted for GitHub; connectionId is only supported for GitHub.",
      ),
    async (a, c) => {
      if (a.provider === "gitlab") {
        const repositories = await c.call({
          method: "GET",
          route: "/gitlab/repositories",
          query: {
            integration: a.integration,
            search: a.search,
            page: Math.floor(a.offset / a.limit) + 1,
            perPage: a.limit,
          },
        });
        return {
          provider: "gitlab",
          integration: a.integration,
          ...repositories,
        };
      }
      const github = await c.call({
        method: "GET",
        route: "/github/installation",
      });
      const connections = records(github.connections);
      const connection = connections.length === 1 ? connections[0] : null;
      const repositories = await c.call({
        method: "GET",
        route: "/github/repositories",
        ...(a.connectionId ? { query: { connectionId: a.connectionId } } : {}),
      });
      return {
        connections,
        unavailableConnections: records(repositories.unavailableConnections),
        identityWarnings: repositories.identityWarnings ?? [],
        githubInstallationId: connection?.id ?? null,
        ...pageItems(
          records(repositories.repositories)
            .filter((item) =>
              JSON.stringify(item)
                .toLowerCase()
                .includes(a.search.toLowerCase()),
            )
            .map((item) => ({
              ...item,
              githubInstallationId: item.connectionId,
            })),
          a.offset,
          a.limit,
        ),
      };
    },
    { permissions: ["githubInstallation.read", "integration.manage"] },
  ),
  tool(
    "github_disconnect",
    "Disconnect GitHub account",
    "Disconnect one connected GitHub account, affecting only its repository syncs and deployments. Confirm the selected account with the user. Other accounts and running workloads remain unaffected.",
    z.object({ connectionId: id("GitHub connection") }).strict(),
    async (a, c) =>
      c.call({
        method: "DELETE",
        route: "/github",
        query: { connectionId: a.connectionId },
      }),
    {
      permissions: ["integration.manage"],
      readOnly: false,
      destructive: true,
      idempotent: true,
    },
  ),
  action(
    "github_retry_reporting",
    "Retry preview reporting",
    "Retry failed GitHub preview status/comment reporting. This retries reporting, not deployment; inspect preview/deployment state separately.",
    "POST",
    "/github/actions/retry-preview-reporting",
    {},
    { destructive: false },
  ),
];
