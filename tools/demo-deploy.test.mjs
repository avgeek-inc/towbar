import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  copyFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const identity = JSON.parse(
  await readFile(new URL("../repository.json", import.meta.url), "utf8"),
);
const image = `${identity.imageRegistry}/towbar-demo@sha256:${"a".repeat(64)}`;
const previous = `TOWBAR_DEMO_IMAGE=${identity.imageRegistry}/towbar-demo@sha256:${"b".repeat(64)}\nDEMO_ORIGIN=https://try.towbar.dev\n`;
async function fixture(t, existing) {
  const root = await mkdtemp(join(tmpdir(), "towbar-demo-deploy-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const folder of ["tools", "infra/demo", "bin"])
    await mkdir(join(root, folder), { recursive: true });
  await copyFile(
    new URL("./deploy-public-demo.sh", import.meta.url),
    join(root, "tools/deploy-public-demo.sh"),
  );
  await copyFile(
    new URL("../repository.json", import.meta.url),
    join(root, "repository.json"),
  );
  if (existing) await writeFile(join(root, "infra/demo/.env"), previous);
  const mocks = {
    uname: 'echo "${MOCK_UNAME:-aarch64}"',
    flock: "exit 0",
    curl: "exit 0",
    node: 'if [[ "$1" == -p ]]; then exec "$REAL_NODE" "$@"; fi; if [[ "$*" == *demo-smoke.mjs* && "${FAIL_SMOKE:-}" == 1 ]]; then exit 1; fi',
    docker: 'printf "%s\\n" "$*" >> "$CALL_LOG"',
  };
  for (const [name, body] of Object.entries(mocks))
    await writeFile(
      join(root, "bin", name),
      `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`,
      { mode: 0o755 },
    );
  const run = (env = {}, digest = image) =>
    spawnSync("bash", [join(root, "tools/deploy-public-demo.sh"), digest], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${join(root, "bin")}:${process.env.PATH}`,
        CALL_LOG: join(root, "calls"),
        REAL_NODE: process.execPath,
        ...env,
      },
    });
  return { root, run, log: () => readFile(join(root, "calls"), "utf8") };
}

test("activation records only the tested digest and retains the previous image", async (t) => {
  const { root, run } = await fixture(t, true);
  const result = run({
    TOWBAR_DEMO_IMAGE: "untrusted-ambient-value",
    DEMO_ORIGIN: "https://wrong.example",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    await readFile(join(root, "infra/demo/.env"), "utf8"),
    `TOWBAR_DEMO_IMAGE=${image}\nDEMO_ORIGIN=https://try.towbar.dev\n`,
  );
  assert.equal(
    await readFile(join(root, "infra/demo/.env.previous"), "utf8"),
    previous,
  );
});

test("failed smoke restores the prior configuration without replacing saved state", async (t) => {
  const { root, run, log } = await fixture(t, true);
  assert.equal(run({ FAIL_SMOKE: "1" }).status, 1);
  assert.equal(await readFile(join(root, "infra/demo/.env"), "utf8"), previous);
  assert.match(
    await log(),
    /--env-file .*\/infra\/demo\/\.env --file infra\/demo\/compose.yml up --detach --wait/,
  );
});

test("failed first activation removes the new stack and rejects mutable image tags", async (t) => {
  const { root, run, log } = await fixture(t, false);
  assert.equal(run({ FAIL_SMOKE: "1" }).status, 1);
  await assert.rejects(readFile(join(root, "infra/demo/.env")));
  assert.match(await log(), /compose.yml down/);
  const before = await log();
  assert.equal(
    run({}, `${identity.imageRegistry}/towbar-demo:latest`).status,
    1,
  );
  assert.equal(await log(), before);
});

test("rejects an amd64 host before pulling the arm64 image", async (t) => {
  const { root, run } = await fixture(t, false);
  const result = run({ MOCK_UNAME: "x86_64" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /requires an arm64 host/);
  await assert.rejects(readFile(join(root, "calls")));
});
