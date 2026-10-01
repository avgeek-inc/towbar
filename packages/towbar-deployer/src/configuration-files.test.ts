import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { readConfigurationFiles } from "./configuration-files.js";

void test("reads exact configuration bytes and rejects traversal, directories, and symlinks", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "towbar-config-test-"));
  try {
    await mkdir(path.join(root, "config"));
    await writeFile(path.join(root, "config", "file"), "configuration\n");
    const file = { source: "config/file", mountPath: "/etc/config" };
    const [read] = await readConfigurationFiles(root, [file]);
    assert.equal(read!.content.toString(), "configuration\n");
    assert.equal(read!.sha256.length, 64);
    await symlink("config", path.join(root, "internal"));
    await symlink("/etc", path.join(root, "escape"));
    await symlink("file", path.join(root, "config", "link"));
    for (const source of [
      "../file",
      "/etc/passwd",
      "config",
      "internal/file",
      "escape/passwd",
      "config/link",
    ])
      await assert.rejects(
        readConfigurationFiles(root, [{ ...file, source }]),
        /Invalid|regular file|symlinks/,
      );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
