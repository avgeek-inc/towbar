import { z } from "zod";
import { integrationFetch } from "../../infrastructure/outbound-network.js";
import type { ProviderConnection } from "@workspace/towbar-core";
import type { GitHubPullRequest } from "../github/client.js";
import { collectGitLabBranches } from "./branch-pages.js";

type GitLabConnection = Extract<ProviderConnection, { provider: "gitlab" }>;
const maxGitLabJsonBytes = 2 * 1_024 * 1_024;

type GitLabProject = {
  projectId?: string;
  repositoryName: string;
  repositoryOwner: string;
};

function projectIdentifier(input: GitLabProject) {
  return input.projectId ?? `${input.repositoryOwner}/${input.repositoryName}`;
}

async function request(
  connection: GitLabConnection,
  projectPath: string,
  path: string,
  init: RequestInit = {},
) {
  const project = encodeURIComponent(projectPath);
  const response = await integrationFetch(
    `${connection.configuration.baseUrl.replace(/\/$/u, "")}/api/v4/projects/${project}${path}`,
    {
      ...init,
      allowPrivateNetwork: connection.configuration.allowPrivateNetwork,
      headers: {
        Authorization: `Bearer ${connection.credentials.token}`,
        ...init.headers,
      },
    },
  );
  if (!response.ok) throw gitLabRequestError(response);
  return response;
}

function gitLabRequestError(response: Response) {
  if (response.status === 401)
    return new Error(
      "GitLab rejected the access token. Test or reconnect the integration.",
    );
  if (response.status === 403)
    return new Error(
      "GitLab denied this operation. Check the token scopes and repository role.",
    );
  if (response.status === 429) {
    const retryAfter = response.headers.get("retry-after");
    return new Error(
      retryAfter
        ? `GitLab rate limited this operation. Retry after ${retryAfter} seconds.`
        : "GitLab rate limited this operation. Retry after the provider reset window.",
    );
  }
  return new Error(`GitLab request failed with status ${response.status}`);
}

async function readGitLabJson(response: Response) {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > maxGitLabJsonBytes)
    throw new Error("GitLab returned an oversized response");
  if (!response.body) throw new Error("GitLab returned an empty response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxGitLabJsonBytes)
        throw new Error("GitLab returned an oversized response");
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
    throw new Error("GitLab returned invalid JSON");
  }
}

const mergeRequestSchema = z.object({
  changes_count: z.string().regex(/^\d+$/u).nullable().optional(),
  draft: z.boolean().optional(),
  iid: z.number().int().positive(),
  sha: z.string().regex(/^[a-f0-9]{40,64}$/u),
  source_branch: z.string(),
  source_project_id: z.number().int().positive().nullable(),
  state: z.enum(["opened", "closed", "locked", "merged"]),
  target_branch: z.string(),
  target_project_id: z.number().int().positive(),
  title: z.string(),
});

export async function listGitLabRepositoryBranches(
  input: GitLabProject & {
    connection: GitLabConnection;
  },
) {
  return collectGitLabBranches({
    maxPages: 100,
    readJson: readGitLabJson,
    requestPage: (page) =>
      request(
        input.connection,
        projectIdentifier(input),
        `/repository/branches?per_page=100&page=${page}`,
      ),
    tooManyError: new Error(
      "GitLab returned more than 10,000 branches. Narrow the repository before connecting it.",
    ),
  });
}

export async function fetchGitLabMergeRequest(
  input: GitLabProject & {
    connection: GitLabConnection;
    pullRequestNumber: number;
  },
): Promise<GitHubPullRequest> {
  const fullName = `${input.repositoryOwner}/${input.repositoryName}`;
  const mergeRequest = mergeRequestSchema.parse(
    await readGitLabJson(
      await request(
        input.connection,
        projectIdentifier(input),
        `/merge_requests/${input.pullRequestNumber}`,
      ),
    ),
  );
  return {
    baseBranch: mergeRequest.target_branch,
    baseRepository: fullName,
    changedFileCount: Number(mergeRequest.changes_count ?? 0),
    draft: mergeRequest.draft ?? /^(?:draft|wip):/iu.test(mergeRequest.title),
    headBranch: mergeRequest.source_branch,
    headRepository:
      mergeRequest.source_project_id === mergeRequest.target_project_id
        ? fullName
        : null,
    headSha: mergeRequest.sha,
    merged: mergeRequest.state === "merged",
    number: mergeRequest.iid,
    state: mergeRequest.state === "opened" ? "open" : "closed",
  };
}

export async function listOpenGitLabMergeRequestNumbers(
  input: GitLabProject & {
    baseBranch: string;
    connection: GitLabConnection;
  },
) {
  const numbers: number[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const response = await request(
      input.connection,
      projectIdentifier(input),
      `/merge_requests?state=opened&target_branch=${encodeURIComponent(input.baseBranch)}&scope=all&per_page=100&page=${page}`,
    );
    const batch = z
      .array(z.object({ iid: z.number().int().positive() }))
      .parse(await readGitLabJson(response));
    numbers.push(...batch.map((item) => item.iid));
    const next = Number(response.headers.get("x-next-page"));
    if (!next || batch.length < 100) break;
    if (page === 20)
      throw new Error(
        "GitLab returned more than 2,000 open merge requests for this branch; preview reconciliation cannot continue safely.",
      );
  }
  return numbers;
}

const diffSchema = z.object({
  collapsed: z.boolean().optional(),
  new_path: z.string(),
  old_path: z.string(),
  too_large: z.boolean().optional(),
});

export async function fetchGitLabMergeRequestChangedPaths(
  input: GitLabProject & {
    changedFileCount: number;
    connection: GitLabConnection;
    pullRequestNumber: number;
  },
) {
  const paths = new Set<string>();
  let complete = true;
  for (let page = 1; page <= 20; page += 1) {
    const response = await request(
      input.connection,
      projectIdentifier(input),
      `/merge_requests/${input.pullRequestNumber}/diffs?per_page=100&page=${page}`,
    );
    const batch = z.array(diffSchema).parse(await readGitLabJson(response));
    for (const diff of batch) {
      paths.add(diff.new_path);
      paths.add(diff.old_path);
      if (diff.collapsed || diff.too_large) complete = false;
    }
    const next = Number(response.headers.get("x-next-page"));
    if (!next || batch.length < 100) break;
    if (page === 20) complete = false;
  }
  if (paths.size < input.changedFileCount) complete = false;
  return { complete, paths: [...paths].sort() };
}

export async function publishGitLabCommitStatus(
  input: GitLabProject & {
    appName: string;
    commitSha: string;
    connection: GitLabConnection;
    description: string;
    environmentUrl: string;
    state: "canceled" | "failed" | "pending" | "running" | "success";
  },
) {
  await request(
    input.connection,
    projectIdentifier(input),
    `/statuses/${encodeURIComponent(input.commitSha)}`,
    {
      body: new URLSearchParams({
        description: input.description.slice(0, 255),
        name: `towbar/${input.appName}`,
        state: input.state,
        target_url: input.environmentUrl,
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      method: "POST",
    },
  );
}

const noteSchema = z.object({
  body: z.string(),
  id: z.number().int().positive(),
});

export async function upsertGitLabMergeRequestComment(
  input: GitLabProject & {
    body: string;
    connection: GitLabConnection;
    marker: string;
    pullRequestNumber: number;
  },
) {
  const project = projectIdentifier(input);
  let existing: z.infer<typeof noteSchema> | undefined;
  for (let page = 1; page <= 10 && !existing; page += 1) {
    const response = await request(
      input.connection,
      project,
      `/merge_requests/${input.pullRequestNumber}/notes?sort=desc&order_by=updated_at&per_page=100&page=${page}`,
    );
    const notes = z.array(noteSchema).parse(await readGitLabJson(response));
    existing = notes.find((note) => note.body.includes(input.marker));
    const next = Number(response.headers.get("x-next-page"));
    if (notes.length < 100 || !next) break;
    if (page === 10 && !existing)
      throw new Error(
        "GitLab merge request has too many notes to update the existing Towbar status safely.",
      );
  }
  const body = JSON.stringify({ body: input.body });
  const response = await request(
    input.connection,
    project,
    existing
      ? `/merge_requests/${input.pullRequestNumber}/notes/${existing.id}`
      : `/merge_requests/${input.pullRequestNumber}/notes`,
    {
      body,
      headers: { "content-type": "application/json" },
      method: existing ? "PUT" : "POST",
    },
  );
  return noteSchema.parse(await readGitLabJson(response));
}
