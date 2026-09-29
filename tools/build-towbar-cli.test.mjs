import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repository = fileURLToPath(new URL("../", import.meta.url));

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "towbar-release-scripts-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "tools"));
  await cp(
    path.join(repository, "infra/towbar-cli"),
    path.join(root, "infra/towbar-cli"),
    {
      recursive: true,
    },
  );
  await cp(
    path.join(repository, "infra/install.sh.in"),
    path.join(root, "infra/install.sh.in"),
  );
  const builder = path.join(root, "tools/build-towbar-cli.mjs");
  await cp(path.join(repository, "tools/build-towbar-cli.mjs"), builder);
  const setVersion = (version) =>
    writeFile(path.join(root, "package.json"), JSON.stringify({ version }));
  const build = (...args) => execFileSync(process.execPath, [builder, ...args]);
  await setVersion("2.45.6");
  build();
  return { root, builder, setVersion, build };
}

test("a package version bump updates the standalone CLI and pinned installer", async (t) => {
  const { root, setVersion, build } = await fixture(t);
  await setVersion("2.45.7");
  build();
  build("--check");

  const cli = path.join(root, "infra/towbar");
  const output = execFileSync("/bin/bash", [cli, "version"], {
    env: {
      ...process.env,
      PATH: "/usr/bin:/bin",
      TOWBAR_ROOT: path.join(root, "not-installed"),
    },
    encoding: "utf8",
  });
  assert.equal(output, "Towbar is not installed\nCLI 2.45.7\n");
  const installer = await readFile(path.join(root, "install.sh"), "utf8");
  assert.match(installer, /INSTALLER_VERSION="v2\.45\.7"/);
  assert.match(
    installer,
    /\$TOWBAR_REPOSITORY\/\$INSTALLER_VERSION\/infra\/towbar/,
  );
  assert(!installer.includes("@TOWBAR_VERSION@"));
  execFileSync("/bin/bash", ["-n", path.join(root, "install.sh"), cli]);
});

test("a version bump without regeneration fails checks without rewriting files", async (t) => {
  const { root, builder, setVersion, build } = await fixture(t);
  const cli = await readFile(path.join(root, "infra/towbar"), "utf8");
  await setVersion("2.45.7");
  const result = spawnSync(process.execPath, [builder, "--check"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  for (const file of [
    "install.sh",
    "infra/towbar",
    "infra/towbar-cli/00-version.sh",
  ]) {
    assert(result.stderr.includes(`${file} is stale; run pnpm cli:build`));
  }
  assert.equal(await readFile(path.join(root, "infra/towbar"), "utf8"), cli);
  build();
  build("--check");
});

test("invalid release versions are rejected before changing scripts", async (t) => {
  const { root, builder, setVersion } = await fixture(t);
  const cli = await readFile(path.join(root, "infra/towbar"), "utf8");
  for (const version of ["2.45.7-rc.1", "02.45.7", '2.45.7"; exit 0', null]) {
    await setVersion(version);
    const result = spawnSync(process.execPath, [builder], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert(
      result.stderr.includes(
        "package.json must declare a stable release version",
      ),
    );
    assert.equal(await readFile(path.join(root, "infra/towbar"), "utf8"), cli);
  }
});
