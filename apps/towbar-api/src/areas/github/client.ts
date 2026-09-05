import { createPrivateKey } from "node:crypto";

import { SignJWT } from "jose";
import { z } from "zod";

import { requireGitHubEnv } from "../../env.js";
import { HttpError } from "../../http/errors.js";
import { githubRequest } from "./request.js";

const installationSchema = z.object({
  account: z.object({
    login: z.string(),
    type: z.string(),
  }),
  id: z.number().int().positive(),
  permissions: z.record(z.string(), z.string()),
  suspended_at: z.string().nullable(),
});

const installationTokenSchema = z.object({
  expires_at: z.string().datetime(),
  token: z.string().min(1),
});

const repositoriesSchema = z.object({
  repositories: z.array(
    z.object({
      default_branch: z.string(),
      full_name: z.string(),
      id: z.number().int().positive(),
      name: z.string(),
      owner: z.object({ login: z.string() }),
      private: z.boolean(),
    }),
  ),
  total_count: z.number().int().nonnegative(),
});

const referenceSchema = z.object({
  object: z.object({
    sha: z.string().regex(/^[a-f0-9]{40}$/u),
    type: z.literal("commit"),
  }),
});

const contentSchema = z.object({
  content: z.string(),
  encoding: z.literal("base64"),
  path: z.literal(".towbar/deployment.yml"),
  sha: z.string(),
  size: z.number().int().nonnegative(),
  type: z.literal("file"),
});

const gitCommitSchema = z.object({
  tree: z.object({ sha: z.string().regex(/^[a-f0-9]{40}$/u) }),
});

const gitTreeSchema = z.object({
  tree: z.array(
    z.object({
      mode: z.string().min(1),
      path: z.string().min(1),
      sha: z.string().regex(/^[a-f0-9]{40}$/u),
      type: z.enum(["blob", "commit", "tree"]),
    }),
  ),
  truncated: z.boolean(),
});

const githubDeploymentSchema = z.object({ id: z.number().int().positive() });
const issueCommentSchema = z.object({
  body: z.string().nullable(),
  id: z.number().int().positive(),
  performed_via_github_app: z
    .object({ id: z.number().int().positive() })
    .nullable()
    .optional(),
});
const issueCommentListSchema = z.array(issueCommentSchema);

type GitHubIssueComment = z.infer<typeof issueCommentSchema>;

const pullRequestFileListSchema = z.array(
  z.object({
    filename: z.string().min(1).max(4_096),
    previous_filename: z.string().min(1).max(4_096).optional(),
  }),
);

const pullRequestSchema = z.object({
  base: z.object({
    ref: z.string().min(1).max(255),
    repo: z.object({ full_name: z.string().min(3).max(255) }),
  }),
  changed_files: z.number().int().nonnegative(),
  draft: z.boolean().nullable(),
  head: z.object({
    ref: z.string().min(1).max(255),
    repo: z.object({ full_name: z.string().min(3).max(255) }).nullable(),
    sha: z.string().regex(/^[a-f0-9]{40}$/u),
  }),
  merged: z.boolean(),
  number: z.number().int().positive().max(2_147_483_647),
  state: z.enum(["closed", "open"]),
});
const pullRequestListSchema = z.array(
  z.object({
    number: z.number().int().positive().max(2_147_483_647),
  }),
);

export type GitHubPullRequest = {
  baseBranch: string;
  baseRepository: string;
  changedFileCount: number;
  draft: boolean;
  headBranch: string;
  headRepository: string | null;
  headSha: string;
  merged: boolean;
  number: number;
  state: "closed" | "open";
};

export async function getGitHubInstallation(installationId: string) {
  const jwt = await createGitHubAppJwt();
  const value = await githubRequest(`/app/installations/${installationId}`, {
    token: jwt,
  });
  return installationSchema.parse(value);
}

export async function deleteGitHubInstallation(installationId: string) {
  const jwt = await createGitHubAppJwt();
  await githubRequest(`/app/installations/${installationId}`, {
    method: "DELETE",
    token: jwt,
  });
}

export async function listGitHubRepositories(installationId: string) {
  const token = await createInstallationToken(installationId);
  const repositories: z.infer<typeof repositoriesSchema>["repositories"] = [];
  for (let page = 1; page <= 10; page += 1) {
    const value = repositoriesSchema.parse(
      await githubRequest(
        `/installation/repositories?per_page=100&page=${page}`,
        { token },
      ),
    );
    repositories.push(...value.repositories);
    if (
      repositories.length >= value.total_count ||
      value.repositories.length < 100
    ) {
      break;
    }
  }
  return repositories.map((repository) => ({
    defaultBranch: repository.default_branch,
    fullName: repository.full_name,
    id: String(repository.id),
    name: repository.name,
    owner: repository.owner.login,
    private: repository.private,
  }));
}

export async function fetchGitHubSourceSnapshot(input: {
  branch: string;
  installationId: string;
  repositoryName: string;
  repositoryOwner: string;
}) {
  const token = await createInstallationToken(input.installationId);
  const repository = `${encodeURIComponent(input.repositoryOwner)}/${encodeURIComponent(input.repositoryName)}`;
  let referenceValue: unknown;
  try {
    referenceValue = await githubRequest(
      `/repos/${repository}/git/ref/heads/${encodeURIComponent(input.branch)}`,
      { token },
    );
  } catch (error) {
    if (isGitHubReferenceUnavailable(error)) {
      throw new HttpError(
        422,
        "SOURCE_BRANCH_NOT_FOUND",
        `Branch '${input.branch}' was not found in ${input.repositoryOwner}/${input.repositoryName}. Push the branch or update this Source, then sync again.`,
      );
    }
    throw error;
  }
  const reference = referenceSchema.parse(referenceValue);
  const commitSha = reference.object.sha;
  return await fetchGitHubManifestSnapshot({ ...input, commitSha });
}

export async function fetchGitHubManifestSnapshot(input: {
  commitSha: string;
  installationId: string;
  repositoryName: string;
  repositoryOwner: string;
}) {
  const token = await createInstallationToken(input.installationId);
  const repository = `${encodeURIComponent(input.repositoryOwner)}/${encodeURIComponent(input.repositoryName)}`;
  let contentValue: unknown;
  try {
    contentValue = await githubRequest(
      `/repos/${repository}/contents/.towbar/deployment.yml?ref=${input.commitSha}`,
      { token },
    );
  } catch (error) {
    if (isGitHubNotFound(error)) {
      throw new HttpError(
        422,
        "MANIFEST_NOT_FOUND",
        `Add .towbar/deployment.yml to commit '${input.commitSha.slice(0, 12)}' in ${input.repositoryOwner}/${input.repositoryName}.`,
      );
    }
    throw error;
  }
  const content = contentSchema.parse(contentValue);
  if (content.size > 256 * 1_024) {
    throw new HttpError(
      422,
      "MANIFEST_TOO_LARGE",
      "The Towbar deployment manifest exceeds 256 KiB",
    );
  }
  return {
    commitSha: input.commitSha,
    manifestSource: Buffer.from(
      content.content.replaceAll("\n", ""),
      "base64",
    ).toString("utf8"),
  };
}

export async function fetchGitHubRepositoryTree(input: {
  commitSha: string;
  installationId: string;
  repositoryName: string;
  repositoryOwner: string;
}) {
  const token = await createInstallationToken(input.installationId);
  const repository = `${encodeURIComponent(input.repositoryOwner)}/${encodeURIComponent(input.repositoryName)}`;
  const commit = gitCommitSchema.parse(
    await githubRequest(
      `/repos/${repository}/git/commits/${encodeURIComponent(input.commitSha)}`,
      { token },
    ),
  );
  const tree = gitTreeSchema.parse(
    await githubRequest(
      `/repos/${repository}/git/trees/${commit.tree.sha}?recursive=1`,
      { token },
    ),
  );
  return {
    complete: !tree.truncated,
    entries: tree.tree
      .filter(
        (entry): entry is typeof entry & { type: "blob" | "commit" } =>
          entry.type === "blob" || entry.type === "commit",
      )
      .map(({ mode, path, sha, type }) => ({ mode, path, sha, type })),
  };
}

export async function fetchGitHubPullRequest(input: {
  installationId: string;
  pullRequestNumber: number;
  repositoryName: string;
  repositoryOwner: string;
}): Promise<GitHubPullRequest> {
  const token = await createInstallationToken(input.installationId);
  const repository = `${encodeURIComponent(input.repositoryOwner)}/${encodeURIComponent(input.repositoryName)}`;
  const pullRequest = pullRequestSchema.parse(
    await githubRequest(
      `/repos/${repository}/pulls/${input.pullRequestNumber}`,
      { token },
    ),
  );
  return {
    baseBranch: pullRequest.base.ref,
    baseRepository: pullRequest.base.repo.full_name,
    changedFileCount: pullRequest.changed_files,
    draft: pullRequest.draft ?? false,
    headBranch: pullRequest.head.ref,
    headRepository: pullRequest.head.repo?.full_name ?? null,
    headSha: pullRequest.head.sha,
    merged: pullRequest.merged,
    number: pullRequest.number,
    state: pullRequest.state,
  };
}

export async function fetchGitHubPullRequestChangedPaths(input: {
  changedFileCount: number;
  installationId: string;
  pullRequestNumber: number;
  repositoryName: string;
  repositoryOwner: string;
}) {
  if (input.changedFileCount === 0) return { complete: true, paths: [] };
  const token = await createInstallationToken(input.installationId);
  const repository = `${encodeURIComponent(input.repositoryOwner)}/${encodeURIComponent(input.repositoryName)}`;
  const paths: string[] = [];
  let fetchedFileCount = 0;
  for (let page = 1; page <= 30; page += 1) {
    const files = pullRequestFileListSchema.parse(
      await githubRequest(
        `/repos/${repository}/pulls/${input.pullRequestNumber}/files?per_page=100&page=${page}`,
        { token },
      ),
    );
    fetchedFileCount += files.length;
    for (const file of files) {
      paths.push(file.filename);
      if (file.previous_filename) paths.push(file.previous_filename);
    }
    if (files.length < 100 || fetchedFileCount >= input.changedFileCount) break;
  }
  return {
    complete: fetchedFileCount >= input.changedFileCount,
    paths,
  };
}

export async function listOpenGitHubPullRequestNumbers(input: {
  baseBranch: string;
  installationId: string;
  repositoryName: string;
  repositoryOwner: string;
}) {
  const token = await createInstallationToken(input.installationId);
  const repository = `${encodeURIComponent(input.repositoryOwner)}/${encodeURIComponent(input.repositoryName)}`;
  const pullRequestNumbers: number[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const pullRequests = pullRequestListSchema.parse(
      await githubRequest(
        `/repos/${repository}/pulls?state=open&base=${encodeURIComponent(input.baseBranch)}&per_page=100&page=${page}`,
        { token },
      ),
    );
    pullRequestNumbers.push(
      ...pullRequests.map((pullRequest) => pullRequest.number),
    );
    if (pullRequests.length < 100) break;
  }
  return pullRequestNumbers;
}

function isGitHubNotFound(error: unknown): error is HttpError {
  return error instanceof HttpError && error.status === 404;
}

function isGitHubReferenceUnavailable(error: unknown): error is HttpError {
  return (
    error instanceof HttpError && (error.status === 404 || error.status === 409)
  );
}

export async function createInstallationToken(installationId: string) {
  const jwt = await createGitHubAppJwt();
  const value = installationTokenSchema.parse(
    await githubRequest(`/app/installations/${installationId}/access_tokens`, {
      method: "POST",
      retry: true,
      token: jwt,
    }),
  );
  return value.token;
}

export async function createGitHubPreviewDeployment(input: {
  commitSha: string;
  environment: string;
  environmentUrl: string;
  installationId: string;
  repositoryName: string;
  repositoryOwner: string;
}) {
  const token = await createInstallationToken(input.installationId);
  const repository = `${encodeURIComponent(input.repositoryOwner)}/${encodeURIComponent(input.repositoryName)}`;
  const deployment = githubDeploymentSchema.parse(
    await githubRequest(`/repos/${repository}/deployments`, {
      body: {
        auto_merge: false,
        description: "Towbar Preview deployment",
        environment: input.environment,
        payload: { environmentUrl: input.environmentUrl, managedBy: "towbar" },
        production_environment: false,
        ref: input.commitSha,
        required_contexts: [],
        transient_environment: true,
      },
      method: "POST",
      token,
    }),
  );
  return String(deployment.id);
}

export async function updateGitHubPreviewDeployment(input: {
  deploymentId: string;
  environmentUrl: string;
  installationId: string;
  repositoryName: string;
  repositoryOwner: string;
  state:
    "error" | "failure" | "inactive" | "in_progress" | "queued" | "success";
}) {
  const token = await createInstallationToken(input.installationId);
  const repository = `${encodeURIComponent(input.repositoryOwner)}/${encodeURIComponent(input.repositoryName)}`;
  await githubRequest(
    `/repos/${repository}/deployments/${encodeURIComponent(input.deploymentId)}/statuses`,
    {
      body: {
        environment_url: input.environmentUrl,
        state: input.state,
      },
      method: "POST",
      token,
    },
  );
}

export async function upsertGitHubPullRequestComment(input: {
  body: string;
  installationId: string;
  marker: string;
  pullRequestNumber: number;
  repositoryName: string;
  repositoryOwner: string;
}) {
  const token = await createInstallationToken(input.installationId);
  const repository = `${encodeURIComponent(input.repositoryOwner)}/${encodeURIComponent(input.repositoryName)}`;
  const appId = requireGitHubEnv().appId;
  const comments: GitHubIssueComment[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const pageComments = issueCommentListSchema.parse(
      await githubRequest(
        `/repos/${repository}/issues/${input.pullRequestNumber}/comments?per_page=100&page=${page}`,
        { token },
      ),
    );
    comments.push(...pageComments);
    if (pageComments.length < 100) break;
  }
  const { canonical, duplicates } = classifyGitHubPullRequestComments({
    appId,
    comments,
    marker: input.marker,
  });
  let comment = canonical;
  if (!comment || comment.body !== input.body) {
    comment = issueCommentSchema.parse(
      await githubRequest(
        comment
          ? `/repos/${repository}/issues/comments/${comment.id}`
          : `/repos/${repository}/issues/${input.pullRequestNumber}/comments`,
        {
          body: { body: input.body },
          method: comment ? "PATCH" : "POST",
          token,
        },
      ),
    );
  }
  for (const duplicate of duplicates) {
    await githubRequest(
      `/repos/${repository}/issues/comments/${duplicate.id}`,
      { method: "DELETE", token },
    );
  }
  return String(comment.id);
}

export function classifyGitHubPullRequestComments(input: {
  appId: string;
  comments: GitHubIssueComment[];
  marker: string;
}) {
  const matches = input.comments
    .filter(
      (comment) =>
        comment.body?.includes(input.marker) === true &&
        String(comment.performed_via_github_app?.id) === input.appId,
    )
    .sort((left, right) => left.id - right.id);
  return {
    canonical: matches[0],
    duplicates: matches.slice(1),
  };
}

async function createGitHubAppJwt() {
  const github = requireGitHubEnv();
  const now = Math.floor(Date.now() / 1_000);
  return await new SignJWT({})
    .setProtectedHeader({ alg: "RS256" })
    .setIssuedAt(now - 30)
    .setIssuer(github.appId)
    .setExpirationTime(now + 9 * 60)
    .sign(createPrivateKey(github.privateKey));
}
