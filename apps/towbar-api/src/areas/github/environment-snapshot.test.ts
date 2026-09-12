import assert from "node:assert/strict";
import test from "node:test";
import { fetchGitHubEnvironmentSnapshot } from "./environment-snapshot.js";

const commitSha = "1".repeat(40);
const treeSha = "2".repeat(40);
const rootSha = "3".repeat(40);
const appSha = "4".repeat(40);
const root = "version: 2\nenvironments:\n  staging: {}\n";
const input = {
  installationId: "1",
  repositoryOwner: "example",
  repositoryName: "app",
  branch: "develop",
};
function mock(
  options: { truncated?: boolean; mode?: string; missingBlob?: boolean } = {},
) {
  const paths: string[] = [];
  return {
    paths,
    dependencies: {
      createToken: () => Promise.resolve("test-token"),
      request: (path: string) => {
        return Promise.resolve().then(() => {
          paths.push(path);
          if (path.includes("/git/ref/"))
            return { object: { sha: commitSha, type: "commit" } };
          if (path.includes("/git/commits/")) return { tree: { sha: treeSha } };
          if (path.includes("/git/trees/"))
            return {
              truncated: options.truncated ?? false,
              tree: [
                {
                  path: "towbar.yml",
                  type: "blob",
                  mode: "100644",
                  sha: rootSha,
                },
                {
                  path: ".towbar/apps",
                  type: "tree",
                  mode: "040000",
                  sha: treeSha,
                },
                {
                  path: ".towbar/apps/site.app.yml",
                  type: "blob",
                  mode: options.mode ?? "100644",
                  sha: appSha,
                },
              ],
            };
          if (options.missingBlob && path.endsWith(appSha))
            throw new Error("GitHub file unavailable");
          const content = path.endsWith(rootSha) ? root : "id: website\n";
          return {
            content: Buffer.from(content).toString("base64"),
            encoding: "base64",
            size: Buffer.byteLength(content),
          };
        });
      },
    },
  };
}

void test("pins branch resolution once and loads all files by blob SHA", async () => {
  const { dependencies, paths } = mock();
  const snapshot = await fetchGitHubEnvironmentSnapshot(input, dependencies);
  assert.equal(snapshot.commitSha, commitSha);
  assert.equal(snapshot.files[0]?.path, ".towbar/apps/site.app.yml");
  assert.equal(snapshot.root, root);
  assert.deepEqual(snapshot.directories, [".towbar/apps"]);
  assert.equal(paths.filter((path) => path.includes("/git/ref/")).length, 1);
  assert(paths.includes(`/repos/example/app/git/commits/${commitSha}`));
  assert(paths.includes(`/repos/example/app/git/blobs/${appSha}`));
});

void test("preview commit loading never resolves a mutable branch", async () => {
  const { dependencies, paths } = mock();
  await fetchGitHubEnvironmentSnapshot(
    {
      installationId: "1",
      repositoryOwner: "example",
      repositoryName: "app",
      commitSha,
    },
    dependencies,
  );
  assert(!paths.some((path) => path.includes("/git/ref/")));
});

void test("rejects incomplete trees before fetching configuration", async () => {
  const { dependencies, paths } = mock({ truncated: true });
  await assert.rejects(
    fetchGitHubEnvironmentSnapshot(input, dependencies),
    /incomplete/,
  );
  assert(!paths.some((path) => path.includes("/git/blobs/")));
});

void test("rejects symlink entity files", async () => {
  const { dependencies } = mock({ mode: "120000" });
  await assert.rejects(
    fetchGitHubEnvironmentSnapshot(input, dependencies),
    /regular file/,
  );
});

void test("one failed file fetch rejects the snapshot rather than returning partial inventory", async () => {
  const { dependencies } = mock({ missingBlob: true });
  await assert.rejects(
    fetchGitHubEnvironmentSnapshot(input, dependencies),
    /unavailable/,
  );
});
