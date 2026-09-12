import { z } from "zod";
import {
  entityFileKind,
  parseRepositoryManifest,
} from "@workspace/towbar-core";
import { HttpError } from "../../http/errors.js";
import { createInstallationToken } from "./client.js";
import { githubRequest } from "./request.js";

const shaSchema = z.string().regex(/^[a-f0-9]{40}$/);
const treeSchema = z.object({
  truncated: z.boolean(),
  tree: z.array(
    z.object({
      path: z.string(),
      mode: z.string(),
      type: z.enum(["blob", "tree", "commit"]),
      sha: shaSchema,
      size: z.number().int().nonnegative().optional(),
    }),
  ),
});
const blobSchema = z.object({
  content: z.string(),
  encoding: z.literal("base64"),
  size: z.number().int().nonnegative(),
});

type SnapshotInput = {
  repositoryOwner: string;
  repositoryName: string;
  installationId: string;
} & (
  { branch: string; commitSha?: never } | { commitSha: string; branch?: never }
);
type Dependencies = {
  request: typeof githubRequest;
  createToken: typeof createInstallationToken;
};

export async function fetchGitHubEnvironmentSnapshot(
  input: SnapshotInput,
  dependencies: Dependencies = {
    request: githubRequest,
    createToken: createInstallationToken,
  },
) {
  const token = await dependencies.createToken(input.installationId);
  const repo = `${encodeURIComponent(input.repositoryOwner)}/${encodeURIComponent(input.repositoryName)}`;
  const request = (path: string) =>
    dependencies.request(`/repos/${repo}${path}`, { token });
  let commitSha: string;
  if (input.commitSha) {
    commitSha = shaSchema.parse(input.commitSha);
  } else {
    const ref = z
      .object({
        object: z.object({ sha: shaSchema, type: z.literal("commit") }),
      })
      .parse(
        await request(`/git/ref/heads/${encodeURIComponent(input.branch!)}`),
      );
    commitSha = ref.object.sha;
  }
  const commit = z
    .object({ tree: z.object({ sha: shaSchema }) })
    .parse(await request(`/git/commits/${commitSha}`));
  const tree = treeSchema.parse(
    await request(`/git/trees/${commit.tree.sha}?recursive=1`),
  );
  if (tree.truncated)
    throw new HttpError(
      422,
      "INCOMPLETE_REPOSITORY_TREE",
      "Repository file listing is incomplete; no environment configuration was synchronized",
    );
  const rootEntry = tree.tree.find((entry) => entry.path === "towbar.yml");
  if (!rootEntry)
    throw new HttpError(
      422,
      "MANIFEST_NOT_FOUND",
      "Add towbar.yml to the selected branch",
    );
  const entities = tree.tree.filter((entry) => entityFileKind(entry.path));
  if (entities.length > 1000)
    throw new HttpError(
      422,
      "MANIFEST_TOO_LARGE",
      "At most 1000 entity files are supported",
    );
  const entries = [rootEntry, ...entities].sort((a, b) =>
    a.path.localeCompare(b.path),
  );
  let totalBytes = 0;
  for (const entry of entries) {
    if (entry.type !== "blob" || !["100644", "100755"].includes(entry.mode)) {
      throw new HttpError(
        422,
        "INVALID_MANIFEST_FILE",
        `${entry.path} must be a regular file, not a symbolic link or submodule`,
      );
    }
    if (entry.size !== undefined && entry.size > 256 * 1024)
      throw new HttpError(
        422,
        "MANIFEST_TOO_LARGE",
        `${entry.path} exceeds 256 KiB`,
      );
  }
  const files: { path: string; content: string }[] = [];
  for (let offset = 0; offset < entries.length; offset += 4) {
    const batch = await Promise.all(
      entries.slice(offset, offset + 4).map(async (entry) => {
        const blob = blobSchema.parse(await request(`/git/blobs/${entry.sha}`));
        const content = Buffer.from(
          blob.content.replaceAll("\n", ""),
          "base64",
        );
        if (blob.size > 256 * 1024 || content.byteLength > 256 * 1024)
          throw new HttpError(
            422,
            "MANIFEST_TOO_LARGE",
            `${entry.path} exceeds 256 KiB`,
          );
        if (content.byteLength !== blob.size)
          throw new HttpError(
            422,
            "INCOMPLETE_MANIFEST_FILE",
            `${entry.path} was not fetched completely`,
          );
        return {
          path: entry.path,
          content: content.toString("utf8"),
          bytes: content.byteLength,
        };
      }),
    );
    for (const file of batch) {
      totalBytes += file.bytes;
      if (totalBytes > 8 * 1024 * 1024)
        throw new HttpError(
          422,
          "MANIFEST_TOO_LARGE",
          "Manifest files exceed 8 MiB in total",
        );
      files.push({ path: file.path, content: file.content });
    }
  }
  const root = files.find((file) => file.path === "towbar.yml")!.content;
  return {
    commitSha,
    root,
    configuration: parseRepositoryManifest(root),
    files: files.filter((file) => file.path !== "towbar.yml"),
    directories: tree.tree
      .filter((entry) => entry.type === "tree")
      .map((entry) => entry.path),
  };
}
