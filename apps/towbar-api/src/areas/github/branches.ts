import { z } from "zod";
import { createInstallationToken } from "./client.js";
import { githubRequest } from "./request.js";
import { getGitHubConnection } from "./service.js";
import { conflict, notFound } from "../../http/errors.js";

export async function listRepositoryBranches(
  input: { installationId: string; owner: string; repository: string },
  dependencies = {
    createToken: createInstallationToken,
    request: githubRequest,
  },
) {
  const token = await dependencies.createToken(input.installationId);
  const names = new Set<string>();
  for (let page = 1; ; page += 1) {
    const branches = z
      .array(z.object({ name: z.string().min(1) }))
      .parse(
        await dependencies.request(
          `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repository)}/branches?per_page=100&page=${page}`,
          { token },
        ),
      );
    for (const branch of branches) names.add(branch.name);
    if (branches.length < 100) return [...names].sort();
  }
}

export async function getWorkspaceRepositoryBranches(
  workspaceId: string,
  input: { owner: string; repository: string },
) {
  const installation = await getGitHubConnection(workspaceId);
  if (!installation) throw notFound("GitHub installation");
  if (installation.suspendedAt)
    throw conflict("Reconnect the GitHub App before listing branches");
  return listRepositoryBranches({
    ...input,
    installationId: installation.installationId,
  });
}
