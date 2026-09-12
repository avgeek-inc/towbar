import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { resourceOperationScripts } from "./resource-operations.js";
import { preflightRestoreScript } from "./resource-restore-scripts.js";

void test("resource operations reject a sibling environment despite matching manifest labels", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "towbar-ownership-"));
  const trace = path.join(directory, "commands");
  const docker = `docker() {
    printf '%s\\n' "$*" >> "$TEST_TRACE"
    case "$*" in
      *towbar.managed*) printf 'true\\n' ;;
      *towbar.deployable*) printf '%s\\n' "$TEST_OWNER" ;;
      *towbar.app*) printf 'database\\n' ;;
      *) return 0 ;;
    esac
  }
`;
  try {
    for (const [script, args] of [
      [
        resourceOperationScripts.createBackup,
        [
          "postgres",
          "staging",
          directory,
          path.join(directory, "backup"),
          "production-id",
        ],
      ],
      [
        resourceOperationScripts.containerOperation,
        ["capture_logs", "staging", "production-id", "20"],
      ],
      [
        preflightRestoreScript,
        ["staging", "production-id", "data", "1", "postgres", "17"],
      ],
    ] as const) {
      for (const owner of ["staging-id", ""]) {
        const result = spawnSync("bash", ["-s", "--", ...args], {
          input: docker + script,
          env: { ...process.env, TEST_TRACE: trace, TEST_OWNER: owner },
          encoding: "utf8",
        });
        assert.notEqual(result.status, 0, result.stderr);
      }
    }
    assert.doesNotMatch(
      readFileSync(trace, "utf8"),
      /^(exec|logs|stop|start|restart|cp|volume) /m,
    );
    const own = spawnSync(
      "bash",
      ["-s", "--", "capture_logs", "production", "production-id", "20"],
      {
        input: docker + resourceOperationScripts.containerOperation,
        env: { ...process.env, TEST_TRACE: trace, TEST_OWNER: "production-id" },
        encoding: "utf8",
      },
    );
    assert.equal(own.status, 0, own.stderr);
    assert.match(
      readFileSync(trace, "utf8"),
      /^logs --timestamps --tail 20 production$/m,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
