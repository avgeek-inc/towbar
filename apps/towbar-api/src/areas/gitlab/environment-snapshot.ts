import { z } from "zod";
import {
  entityFileKind,
  parseRepositoryManifest,
} from "@workspace/towbar-core";
import { HttpError } from "../../http/errors.js";
import { integrationFetch } from "../../infrastructure/outbound-network.js";
import { resolveIntegrationById } from "../integrations/service.js";

const shaSchema = z.string().regex(/^[a-f0-9]{40,64}$/u);
const treeEntrySchema = z.object({
  id: shaSchema,
  mode: z.string(),
  path: z.string(),
  type: z.enum(["blob", "tree", "commit"]),
});

type SnapshotInput = {
  connectionId: string;
  projectId?: string;
  repositoryName: string;
  repositoryOwner: string;
  workspaceId: string;
} & (
  { branch: string; commitSha?: never } | { branch?: never; commitSha: string }
);

async function readBoundedResponse(response: Response, limit: number) {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > limit)
    throw new HttpError(
      422,
      "GITLAB_RESPONSE_TOO_LARGE",
      "GitLab returned an oversized repository response",
    );
  if (!response.body)
    throw new HttpError(
      503,
      "GITLAB_REQUEST_FAILED",
      "GitLab returned an empty repository response",
    );
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit)
        throw new HttpError(
          422,
          "GITLAB_RESPONSE_TOO_LARGE",
          "GitLab returned an oversized repository response",
        );
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks, length);
}

async function readBoundedJson(response: Response, limit = 2 * 1_024 * 1_024) {
  try {
    return JSON.parse(
      (await readBoundedResponse(response, limit)).toString("utf8"),
    ) as unknown;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(
      503,
      "GITLAB_REQUEST_FAILED",
      "GitLab returned invalid repository data",
    );
  }
}

export async function fetchGitLabEnvironmentSnapshot(input: SnapshotInput) {
  const resolved = await resolveIntegrationById({
    id: input.connectionId,
    providers: ["gitlab"],
    target: { kind: "workspace", purpose: "source" },
    workspaceId: input.workspaceId,
  });
  if (resolved.connectionInput.provider !== "gitlab")
    throw new Error("GitLab integration resolution returned another provider");
  const { configuration, credentials } = resolved.connectionInput;
  const project = encodeURIComponent(
    input.projectId ?? `${input.repositoryOwner}/${input.repositoryName}`,
  );
  const request = async (path: string) => {
    const response = await integrationFetch(
      `${configuration.baseUrl}/api/v4/projects/${project}${path}`,
      {
        allowPrivateNetwork: configuration.allowPrivateNetwork,
        headers: { Authorization: `Bearer ${credentials.token}` },
      },
    );
    if (!response.ok)
      throw new HttpError(
        response.status === 404 ? 404 : 503,
        "GITLAB_REQUEST_FAILED",
        `GitLab repository request failed with status ${response.status}`,
      );
    return response;
  };
  const commitSha = input.commitSha
    ? shaSchema.parse(input.commitSha)
    : shaSchema.parse(
        (
          (await readBoundedJson(
            await request(
              `/repository/branches/${encodeURIComponent(input.branch!)}`,
            ),
          )) as { commit?: { id?: string } }
        ).commit?.id,
      );
  const entries: z.infer<typeof treeEntrySchema>[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const response = await request(
      `/repository/tree?ref=${encodeURIComponent(commitSha)}&recursive=true&per_page=100&page=${page}`,
    );
    const batch = z
      .array(treeEntrySchema)
      .parse(await readBoundedJson(response));
    entries.push(...batch);
    if (entries.length > 1_000)
      throw new HttpError(
        422,
        "MANIFEST_TOO_LARGE",
        "At most 1000 repository files are supported",
      );
    if (batch.length < 100) break;
    if (page === 20)
      throw new HttpError(
        422,
        "INCOMPLETE_REPOSITORY_TREE",
        "Repository file listing is incomplete",
      );
  }
  const rootEntry = entries.find((entry) => entry.path === "towbar.yml");
  if (!rootEntry)
    throw new HttpError(
      422,
      "MANIFEST_NOT_FOUND",
      "Add towbar.yml to the selected branch",
    );
  const manifestEntries = [
    rootEntry,
    ...entries.filter((entry) => entityFileKind(entry.path)),
  ].sort((left, right) => left.path.localeCompare(right.path));
  const files: Array<{ content: string; path: string }> = [];
  let totalBytes = 0;
  for (const entry of manifestEntries) {
    if (entry.type !== "blob" || !["100644", "100755"].includes(entry.mode))
      throw new HttpError(
        422,
        "INVALID_MANIFEST_FILE",
        `${entry.path} must be a regular file`,
      );
    const response = await request(
      `/repository/blobs/${encodeURIComponent(entry.id)}/raw`,
    );
    const content = await readBoundedResponse(response, 256 * 1_024);
    totalBytes += content.byteLength;
    if (totalBytes > 8 * 1_024 * 1_024)
      throw new HttpError(
        422,
        "MANIFEST_TOO_LARGE",
        "Manifest files exceed 8 MiB in total",
      );
    files.push({ content: content.toString("utf8"), path: entry.path });
  }
  const root = files.find((file) => file.path === "towbar.yml")!.content;
  return {
    commitSha,
    configuration: parseRepositoryManifest(root),
    directories: entries
      .filter((entry) => entry.type === "tree")
      .map((entry) => entry.path),
    files: files.filter((file) => file.path !== "towbar.yml"),
    root,
    repositoryTree: {
      complete: true,
      entries: entries
        .filter(
          (entry): entry is typeof entry & { type: "blob" | "commit" } =>
            entry.type === "blob" || entry.type === "commit",
        )
        .map((entry) => ({
          mode: entry.mode,
          path: entry.path,
          sha: entry.id,
          type: entry.type,
        })),
    },
  };
}
