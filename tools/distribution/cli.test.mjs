import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { identity, sha256 } from "./release.mjs";

const repository = new URL("../../", import.meta.url).pathname;
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "towbar-download-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "remote"));
  await mkdir(join(root, "bin"));
  const commit = "a".repeat(40),
    version = "v2.0.30";
  const archive = Buffer.from("a damaged archive that must never be extracted");
  const images = Buffer.from(JSON.stringify({ version, commit, images: {} }));
  await writeFile(join(root, "remote/source.tar.gz"), archive);
  await writeFile(join(root, "remote/towbar-images.json"), images);
  await writeFile(
    join(root, "remote/release.json"),
    JSON.stringify({
      version,
      commit,
      validated: true,
      artifacts: {
        "source.tar.gz": sha256("valid archive"),
        "towbar-images.json": sha256(images),
      },
    }),
  );
  await writeFile(
    join(root, "bin/curl"),
    `#!/usr/bin/env bash\nset -euo pipefail\noutput=""; url=""\nwhile (($#)); do\n case "$1" in --output) output="$2"; shift;; https://*) url="$1";; esac\n shift\ndone\nif [[ -n "$output" ]]; then cp "$REMOTE/\${url##*/}" "$output"; else cat "$REMOTE/\${url##*/}"; fi\n`,
    { mode: 0o755 },
  );
  const run = () =>
    spawnSync(
      "bash",
      [
        "-c",
        `source "$REPOSITORY/infra/towbar-cli/00-version.sh"; source "$REPOSITORY/infra/towbar-cli/00-runtime.sh"; source "$REPOSITORY/infra/towbar-cli/30-release.sh"; download_release v2.0.30 ${commit}`,
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          REPOSITORY: repository,
          REMOTE: join(root, "remote"),
          TOWBAR_ROOT: join(root, "installation"),
          PATH: `${join(root, "bin")}:${process.env.PATH}`,
        },
      },
    );
  return { root, run };
}
test("CLI rejects a corrupted source archive before extraction or activation", async (t) => {
  const { root, run } = await fixture(t);
  const result = run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /source.tar.gz checksum verification failed/);
  await assert.rejects(
    readFile(join(root, "installation/releases/v2.0.30/.towbar-release")),
  );
});
test("release workflow only promotes after the candidate installation job succeeds", async () => {
  const text = await readFile(
    new URL("../../.github/workflows/release-images.yml", import.meta.url),
    "utf8",
  );
  assert.match(
    text,
    /publish:\n\s+needs: \[prepare, manifest, local-installation-smoke\]/,
  );
  assert.match(
    text,
    /INSTALLER_URL: \$\{\{ needs.prepare.outputs.distribution_url \}\}\/releases\//,
  );
  assert.match(text, /TOWBAR_RELEASE_SMOKE=true/);
  assert(!text.includes("raw.githubusercontent.com"));
});

test("repository transfer guard fails for the upstream ID and permits forks", () => {
  const run = (id, name) =>
    spawnSync(
      process.execPath,
      ["tools/sync-repository-identity.mjs", "--check"],
      {
        cwd: repository,
        encoding: "utf8",
        env: {
          ...process.env,
          GITHUB_REPOSITORY_ID: String(id),
          GITHUB_REPOSITORY: name,
        },
      },
    );
  const wrongUpstream = run(identity.repositoryId, "renamed-owner/towbar");
  assert.notEqual(wrongUpstream.status, 0);
  assert.match(wrongUpstream.stderr, /renamed or transferred/);
  assert.equal(run(identity.repositoryId + 1, "contributor/towbar").status, 0);
});
