import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import { createBuildContextArchive } from "./build-context.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await rm(directory, { force: true, recursive: true });
    }),
  );
});

void describe("build context isolation", () => {
  void it("archives a regular context and returns its Dockerfile path", async () => {
    const root = await temporaryDirectory();
    const checkout = path.join(root, "checkout");
    const context = path.join(checkout, "services", "api");
    await mkdir(context, { recursive: true });
    await writeFile(path.join(context, "Dockerfile"), "FROM scratch\n");

    const result = await createBuildContextArchive({
      archivePath: path.join(root, "context.tar.gz"),
      checkout,
      contextPath: "services/api",
      dockerfilePath: "services/api/Dockerfile",
    });

    assert.equal(result.relativeDockerfile, "Dockerfile");
  });

  void it("rejects a context symlink that leaves the checkout", async () => {
    const root = await temporaryDirectory();
    const checkout = path.join(root, "checkout");
    const outside = path.join(root, "outside");
    await mkdir(checkout, { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(path.join(outside, "Dockerfile"), "FROM scratch\n");
    await symlink(outside, path.join(checkout, "context"));

    await assert.rejects(
      createBuildContextArchive({
        archivePath: path.join(root, "context.tar.gz"),
        checkout,
        contextPath: "context",
        dockerfilePath: "context/Dockerfile",
      }),
      /Build context escaped the checkout/u,
    );
  });

  void it("rejects a Dockerfile symlink that leaves the context", async () => {
    const root = await temporaryDirectory();
    const checkout = path.join(root, "checkout");
    const context = path.join(checkout, "context");
    const outside = path.join(root, "Dockerfile");
    await mkdir(context, { recursive: true });
    await writeFile(outside, "FROM scratch\n");
    await symlink(outside, path.join(context, "Dockerfile"));

    await assert.rejects(
      createBuildContextArchive({
        archivePath: path.join(root, "context.tar.gz"),
        checkout,
        contextPath: "context",
        dockerfilePath: "context/Dockerfile",
      }),
      /Dockerfile escaped the checkout/u,
    );
  });
});

async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(tmpdir(), "towbar-context-test-"));
  temporaryDirectories.push(directory);
  return directory;
}
