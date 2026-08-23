import { createPrivateKey } from "node:crypto";

import { SignJWT } from "jose";
import { z } from "zod";

import { requireGitHubEnv } from "../../env.js";
import { HttpError, serviceUnavailable } from "../../http/errors.js";

const githubApiBaseUrl = "https://api.github.com";
const githubAccept = "application/vnd.github+json";

const installationSchema = z.object({
  account: z.object({
    login: z.string(),
    type: z.string(),
  }),
  id: z.number().int().positive(),
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
  let contentValue: unknown;
  try {
    contentValue = await githubRequest(
      `/repos/${repository}/contents/.towbar/deployment.yml?ref=${commitSha}`,
      { token },
    );
  } catch (error) {
    if (isGitHubNotFound(error)) {
      throw new HttpError(
        422,
        "MANIFEST_NOT_FOUND",
        `Add .towbar/deployment.yml to branch '${input.branch}' in ${input.repositoryOwner}/${input.repositoryName}, then sync again.`,
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
    commitSha,
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
      token: jwt,
    }),
  );
  return value.token;
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

async function githubRequest(
  path: string,
  options: { method?: "DELETE" | "GET" | "POST"; token: string },
) {
  let response: Response;
  try {
    response = await fetch(`${githubApiBaseUrl}${path}`, {
      headers: {
        accept: githubAccept,
        authorization: `Bearer ${options.token}`,
        "user-agent": "towbar.dev",
        "x-github-api-version": "2022-11-28",
      },
      method: options.method ?? "GET",
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw serviceUnavailable("GitHub could not be reached", { cause: error });
  }
  if (!response.ok) {
    const requestId = response.headers.get("x-github-request-id");
    throw new HttpError(
      githubErrorStatus(response.status),
      "GITHUB_REQUEST_FAILED",
      requestId
        ? `GitHub rejected the request (${requestId})`
        : "GitHub rejected the request",
    );
  }
  return response.status === 204 ? null : ((await response.json()) as unknown);
}

function githubErrorStatus(status: number): 403 | 404 | 409 | 502 {
  if (status === 403 || status === 404 || status === 409) return status;
  return 502;
}
