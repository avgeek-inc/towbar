import { z } from "zod";
import { and, asc, eq, isNull } from "drizzle-orm";
import { integrationScopeAllows } from "@workspace/towbar-core";
import { integrationAuthorizations } from "@workspace/towbar-database/schema";
import { integrationFetch } from "../../infrastructure/outbound-network.js";
import { serviceUnavailable } from "../../http/errors.js";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import { resolveIntegration } from "../integrations/service.js";

const projectSchema = z.object({
  default_branch: z.string().nullable(),
  id: z.number().int().positive(),
  name: z.string(),
  namespace: z.object({ full_path: z.string() }),
  path: z.string(),
  path_with_namespace: z.string(),
  visibility: z.enum(["private", "internal", "public"]),
  web_url: z.url(),
});
const groupSchema = z.object({
  full_path: z.string(),
  id: z.number().int().positive(),
  name: z.string(),
  visibility: z.enum(["private", "internal", "public"]),
  web_url: z.url(),
});
const branchSchema = z.object({ name: z.string() });
const maxGitLabDiscoveryResponseBytes = 4 * 1_024 * 1_024;

async function readGitLabDiscoveryJson(response: Response) {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > maxGitLabDiscoveryResponseBytes)
    throw serviceUnavailable("GitLab returned an oversized discovery response");
  if (!response.body)
    throw serviceUnavailable("GitLab returned an empty discovery response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxGitLabDiscoveryResponseBytes)
        throw serviceUnavailable(
          "GitLab returned an oversized discovery response",
        );
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  try {
    return JSON.parse(
      Buffer.concat(chunks, length).toString("utf8"),
    ) as unknown;
  } catch {
    throw serviceUnavailable("GitLab returned invalid discovery data");
  }
}

export async function listAvailableGitLabConnections(workspaceId: string) {
  const connections = await getTowbarDatabase()
    .select({
      description: integrationAuthorizations.description,
      id: integrationAuthorizations.id,
      name: integrationAuthorizations.name,
      scopes: integrationAuthorizations.scopes,
      slug: integrationAuthorizations.slug,
      verificationStatus: integrationAuthorizations.verificationStatus,
    })
    .from(integrationAuthorizations)
    .where(
      and(
        eq(integrationAuthorizations.workspaceId, workspaceId),
        eq(integrationAuthorizations.provider, "gitlab"),
        isNull(integrationAuthorizations.disconnectedAt),
      ),
    )
    .orderBy(asc(integrationAuthorizations.name));
  return connections
    .filter((connection) =>
      integrationScopeAllows(connection.scopes, {
        kind: "workspace",
        purpose: "source",
      }),
    )
    .map(({ scopes: _scopes, ...connection }) => connection);
}

async function gitlabConnection(workspaceId: string, slug: string) {
  const resolved = await resolveIntegration({
    providers: ["gitlab"],
    slug,
    target: { kind: "workspace", purpose: "source" },
    workspaceId,
  });
  if (resolved.connectionInput.provider !== "gitlab")
    throw new Error("GitLab integration resolved an incompatible provider");
  return resolved.connectionInput;
}

async function gitlabRequest(
  connection: Awaited<ReturnType<typeof gitlabConnection>>,
  path: string,
) {
  const response = await integrationFetch(
    `${connection.configuration.baseUrl.replace(/\/$/u, "")}/api/v4${path}`,
    {
      allowPrivateNetwork: connection.configuration.allowPrivateNetwork,
      headers: { Authorization: `Bearer ${connection.credentials.token}` },
    },
  );
  if (!response.ok) {
    const message =
      response.status === 401
        ? "GitLab rejected the access token. Test or reconnect the integration."
        : response.status === 403
          ? "GitLab denied repository discovery. Check the token scopes and group or project role."
          : response.status === 429
            ? response.headers.get("retry-after")
              ? `GitLab rate limited repository discovery. Retry after ${response.headers.get("retry-after")} seconds.`
              : "GitLab rate limited repository discovery. Retry after the provider reset window."
            : `GitLab request failed with status ${response.status}. Check the connection.`;
    throw serviceUnavailable(message);
  }
  return response;
}

export async function listGitLabRepositories(input: {
  workspaceId: string;
  integration: string;
  page: number;
}) {
  const connection = await gitlabConnection(
    input.workspaceId,
    input.integration,
  );
  const response = await gitlabRequest(
    connection,
    `/projects?membership=true&simple=true&order_by=path_with_namespace&sort=asc&per_page=100&page=${input.page}`,
  );
  const projects = z
    .array(projectSchema)
    .parse(await readGitLabDiscoveryJson(response));
  return {
    repositories: projects.map((project) => ({
      defaultBranch: project.default_branch,
      fullName: project.path_with_namespace,
      id: String(project.id),
      name: project.path,
      owner: project.namespace.full_path,
      private: project.visibility !== "public",
      provider: "gitlab" as const,
      webUrl: project.web_url,
    })),
    nextPage:
      response.headers.get("x-next-page") || projects.length < 100
        ? Number(response.headers.get("x-next-page")) || null
        : input.page + 1,
  };
}

export async function listGitLabGroups(input: {
  workspaceId: string;
  integration: string;
  page: number;
}) {
  const connection = await gitlabConnection(
    input.workspaceId,
    input.integration,
  );
  const response = await gitlabRequest(
    connection,
    `/groups?min_access_level=10&order_by=name&sort=asc&per_page=100&page=${input.page}`,
  );
  const groups = z
    .array(groupSchema)
    .parse(await readGitLabDiscoveryJson(response));
  return {
    groups: groups.map((group) => ({
      fullPath: group.full_path,
      id: String(group.id),
      name: group.name,
      private: group.visibility !== "public",
      webUrl: group.web_url,
    })),
    nextPage: Number(response.headers.get("x-next-page")) || null,
  };
}

export async function listGitLabBranches(input: {
  workspaceId: string;
  integration: string;
  repositoryOwner: string;
  repositoryName: string;
}) {
  const connection = await gitlabConnection(
    input.workspaceId,
    input.integration,
  );
  const project = encodeURIComponent(
    `${input.repositoryOwner}/${input.repositoryName}`,
  );
  const branches: string[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const response = await gitlabRequest(
      connection,
      `/projects/${project}/repository/branches?per_page=100&page=${page}`,
    );
    const batch = z
      .array(branchSchema)
      .parse(await readGitLabDiscoveryJson(response));
    branches.push(...batch.map((branch) => branch.name));
    const next = Number(response.headers.get("x-next-page"));
    if (!next || batch.length < 100) break;
    if (page === 20)
      throw serviceUnavailable(
        "GitLab returned more than 2,000 branches. Narrow the repository before connecting it.",
      );
  }
  return [...new Set(branches)].sort((left, right) =>
    left.localeCompare(right),
  );
}
