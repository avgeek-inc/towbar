import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { cleanupPreviewRemoteScript } from "./remote-scripts.js";

function cleanup(mode: string) {
  const directory = mkdtempSync(path.join(tmpdir(), "towbar-cleanup-"));
  try {
    writeFileSync(
      path.join(directory, "docker"),
      `#!/bin/bash
set -eu
case "$1 $2" in
  'container ls')
    if [[ "$*" = *--filter* ]]; then
      [[ "$*" = *label=towbar.app=preview-runtime* ]] || exit 8
      if [ "$MODE" = orphan ]; then echo orphan-container; fi
      exit 0
    fi
    if [ "$MODE" = daemon ]; then echo 'daemon unavailable' >&2; exit 1; fi
    if [ "$MODE" != missing ] && [ "$MODE" != orphan ]; then echo preview-container; fi ;;
  'image ls')
    if [[ "$*" = *--filter* ]]; then
      [[ "$*" = *label=towbar.app=preview-runtime* ]] || exit 8
      if [ "$MODE" = orphan ]; then echo towbar/orphan:tag; fi
      exit 0
    fi
    if [ "$MODE" != missing ] && [ "$MODE" != orphan ]; then echo towbar/preview:tag; fi ;;
  'rm -f')
    if [ "$MODE" = orphan ]; then echo "removed container $3" >&2; fi
    if [ "$MODE" = container ]; then echo 'container removal failed' >&2; exit 1; fi
    if [ "$MODE" = missing ]; then echo 'unexpected remove' >&2; exit 9; fi ;;
  'image rm')
    if [ "$MODE" = orphan ]; then echo "removed image $3" >&2; fi
    if [ "$MODE" = image ]; then echo 'image in use' >&2; exit 1; fi
    if [ "$MODE" = missing ]; then echo 'unexpected remove' >&2; exit 9; fi ;;
  *) echo 'unexpected docker command' >&2; exit 9 ;;
esac
`,
      { mode: 0o700 },
    );
    writeFileSync(
      path.join(directory, "sudo"),
      '#!/bin/bash\nif [ "$1" = test ]; then exit 1; fi\nexit 0\n',
      { mode: 0o700 },
    );
    return spawnSync(
      "bash",
      [
        "-s",
        "--",
        "preview-runtime",
        "1",
        "preview-container",
        "1",
        "towbar/preview:tag",
      ],
      {
        input: cleanupPreviewRemoteScript,
        encoding: "utf8",
        env: {
          ...process.env,
          // eslint-disable-next-line turbo/no-undeclared-env-vars -- Test shims retain host shell utilities on PATH.
          PATH: `${directory}:${process.env.PATH}`,
          MODE: mode,
        },
      },
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

for (const [mode, message] of [
  ["container", "container removal failed"],
  ["image", "image in use"],
  ["daemon", "daemon unavailable"],
]) {
  void test(`preview cleanup reports ${mode} failure`, () => {
    const result = cleanup(mode!);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(message!));
  });
}
void test("preview cleanup succeeds when objects were already removed", () => {
  const result = cleanup("missing");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
});
void test("preview cleanup removes existing objects", () => {
  const result = cleanup("present");
  assert.equal(result.status, 0, result.stderr);
});

void test("preview cleanup removes runtime-labeled candidates without release records", () => {
  const result = cleanup("orphan");
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stderr.trim().split("\n"), [
    "removed container orphan-container",
    "removed image towbar/orphan:tag",
  ]);
});
