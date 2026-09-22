import { and, eq } from "drizzle-orm";
import { z } from "zod";

import {
  deployments,
  integrationInstallations,
  sources,
} from "@workspace/towbar-database/schema";

import { notFound } from "../../http/errors.js";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import { createInstallationToken } from "../github/client.js";
import { githubRequest } from "../github/request.js";
import { integrationFetch } from "../../infrastructure/outbound-network.js";
import { resolveIntegrationById } from "../integrations/service.js";

const commitSchema = z.object({
  commit: z.object({ message: z.string() }),
});

const pullRequestSchema = z.object({
  base: z.object({ ref: z.string() }),
  changed_files: z.number().int().nonnegative(),
  draft: z.boolean().nullable(),
  head: z.object({ ref: z.string() }),
  html_url: z.url(),
  merged: z.boolean(),
  number: z.number().int().positive(),
  state: z.enum(["closed", "open"]),
  title: z.string(),
  user: z.object({ login: z.string() }).nullable(),
});

export function pullRequestNumberFromRevision({
  commitMessage,
  gitRef,
}: {
  commitMessage?: string;
  gitRef?: string | null;
}) {
  const refMatch = gitRef?.match(/^refs\/pull\/(\d+)\/(?:head|merge)$/u);
  if (refMatch) return Number(refMatch[1]);

  const subject = commitMessage?.split("\n", 1)[0]?.trim();
  if (!subject) return null;
  const messageMatch =
    subject.match(/^Merge pull request #(\d+)\b/iu) ??
    subject.match(/\(#(\d+)\)\s*$/u);
  return messageMatch ? Number(messageMatch[1]) : null;
}

function mergeRequestNumberFromRevision({
  gitRef,
}: {
  gitRef?: string | null;
}) {
  const match = gitRef?.match(/^refs\/merge-requests\/(\d+)\/(?:head|merge)$/u);
  return match ? Number(match[1]) : null;
}

export async function getDeploymentSourceRevision(
  deploymentId: string,
  workspaceId: string,
) {
  const [revision] = await getTowbarDatabase()
    .select({
      commitSha: deployments.commitSha,
      gitRef: deployments.gitRef,
      installationId: integrationInstallations.externalId,
      integrationAuthorizationId: sources.integrationAuthorizationId,
      providerRepositoryId: sources.providerRepositoryId,
      provider: sources.provider,
      repositoryName: sources.repositoryName,
      repositoryOwner: sources.repositoryOwner,
      sourceId: sources.id,
      targetEnvironment: deployments.targetEnvironment,
    })
    .from(deployments)
    .innerJoin(sources, eq(sources.id, deployments.sourceId))
    .leftJoin(
      integrationInstallations,
      eq(integrationInstallations.id, sources.integrationInstallationId),
    )
    .where(
      and(
        eq(deployments.id, deploymentId),
        eq(deployments.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (!revision) throw notFound("Deployment");

  if (revision.provider === "gitlab") {
    if (!revision.integrationAuthorizationId)
      throw new Error("GitLab repository is missing its integration");
    if (!revision.providerRepositoryId)
      throw new Error("GitLab repository is missing its project ID");
    const integration = await resolveIntegrationById({
      id: revision.integrationAuthorizationId,
      providers: ["gitlab"],
      target: {
        environment: revision.targetEnvironment.name,
        kind: "repository",
        purpose: "source",
        repositoryId: revision.sourceId,
      },
      workspaceId,
    });
    if (integration.connectionInput.provider !== "gitlab")
      throw new Error("GitLab repository resolved an incompatible integration");
    const gitlab = integration.connectionInput;
    const project = encodeURIComponent(revision.providerRepositoryId);
    const request = async (path: string) => {
      const response = await integrationFetch(
        `${gitlab.configuration.baseUrl}/api/v4/projects/${project}${path}`,
        {
          allowPrivateNetwork: gitlab.configuration.allowPrivateNetwork,
          headers: {
            Authorization: `Bearer ${gitlab.credentials.token}`,
          },
        },
      );
      if (!response.ok)
        throw new Error(
          `GitLab revision request failed with status ${response.status}`,
        );
      return response;
    };
    let mergeRequestNumber = mergeRequestNumberFromRevision({
      gitRef: revision.gitRef,
    });
    if (!mergeRequestNumber) {
      const commit = (await readGitLabRevisionJson(
        await request(
          `/repository/commits/${encodeURIComponent(revision.commitSha)}`,
        ),
      )) as { title?: string };
      const match = commit.title?.match(
        /(?:See merge request .*!(\d+)|!(\d+))\s*$/u,
      );
      mergeRequestNumber = match ? Number(match[1] ?? match[2]) : null;
    }
    if (!mergeRequestNumber) return { pullRequest: null };
    const mergeRequest = z
      .object({
        author: z.object({ username: z.string() }).nullable(),
        changes_count: z.string().regex(/^\d+$/u).nullable().optional(),
        iid: z.number().int().positive(),
        source_branch: z.string(),
        state: z.enum(["opened", "closed", "locked", "merged"]),
        target_branch: z.string(),
        title: z.string(),
        web_url: z.url(),
      })
      .parse(
        await readGitLabRevisionJson(
          await request(
            `/merge_requests/${encodeURIComponent(String(mergeRequestNumber))}`,
          ),
        ),
      );
    return {
      pullRequest: {
        author: mergeRequest.author?.username ?? null,
        baseBranch: mergeRequest.target_branch,
        changedFileCount: Number(mergeRequest.changes_count ?? 0),
        draft: /^(?:draft|wip):/iu.test(mergeRequest.title),
        headBranch: mergeRequest.source_branch,
        merged: mergeRequest.state === "merged",
        number: mergeRequest.iid,
        state: mergeRequest.state === "opened" ? "open" : "closed",
        title: mergeRequest.title,
        url: mergeRequest.web_url,
      },
    };
  }

  if (!revision.installationId)
    throw new Error("GitHub repository is missing its installation");

  const token = await createInstallationToken(revision.installationId);
  const repository = `${encodeURIComponent(revision.repositoryOwner)}/${encodeURIComponent(revision.repositoryName)}`;
  let pullRequestNumber = pullRequestNumberFromRevision({
    gitRef: revision.gitRef,
  });
  if (!pullRequestNumber) {
    const commit = commitSchema.parse(
      await githubRequest(
        `/repos/${repository}/commits/${encodeURIComponent(revision.commitSha)}`,
        { token },
      ),
    );
    pullRequestNumber = pullRequestNumberFromRevision({
      commitMessage: commit.commit.message,
    });
  }
  if (!pullRequestNumber) return { pullRequest: null };

  const pullRequest = pullRequestSchema.parse(
    await githubRequest(`/repos/${repository}/pulls/${pullRequestNumber}`, {
      token,
    }),
  );
  return {
    pullRequest: {
      author: pullRequest.user?.login ?? null,
      baseBranch: pullRequest.base.ref,
      changedFileCount: pullRequest.changed_files,
      draft: pullRequest.draft ?? false,
      headBranch: pullRequest.head.ref,
      merged: pullRequest.merged,
      number: pullRequest.number,
      state: pullRequest.state,
      title: pullRequest.title,
      url: pullRequest.html_url,
    },
  };
}

async function readGitLabRevisionJson(response: Response) {
  const limit = 2 * 1_024 * 1_024;
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > limit)
    throw new Error("GitLab returned an oversized revision response");
  if (!response.body)
    throw new Error("GitLab returned an empty revision response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit)
        throw new Error("GitLab returned an oversized revision response");
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
    throw new Error("GitLab returned invalid revision data");
  }
}
