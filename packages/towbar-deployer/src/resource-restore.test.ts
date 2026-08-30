import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  ManagedRestoreError,
  executeManagedRestore,
  executeRestoreCleanup,
  restoreScripts,
} from "./resource-restore.js";

import type {
  BackupStorage,
  ResourceOperationExecutionContext,
  ResourceOperationSecrets,
} from "./types.js";
import type { NormalizedResource } from "@workspace/towbar-core";
import type { SshSession } from "./ssh.js";

const sourceId = "11111111-1111-4111-8111-111111111111";
const deployableId = "21111111-1111-4111-8111-111111111111";
const operationId = "31111111-1111-4111-8111-111111111111";
const backupId = "41111111-1111-4111-8111-111111111111";
const releaseId = "51111111-1111-4111-8111-111111111111";
const restoreId = "61111111-1111-4111-8111-111111111111";
const backupBody = Buffer.from("verified Towbar backup fixture", "utf8");
const checksum = createHash("sha256").update(backupBody).digest("hex");

type Engine = "postgres" | "redis";
type Failure =
  | "corrupt"
  | "health"
  | "incompatible"
  | "insufficient_disk"
  | "rollback"
  | null;

function resourceFixture(engine: Engine): NormalizedResource {
  return {
    autoDeploy: true,
    backup: {
      retention: { keepLast: 7 },
      s3: {
        bucket: "towbar-fixture-backups",
        encryption: "AES256",
        prefix: "fixtures",
      },
    },
    container: {
      command: [],
      resources: { cpus: 1, memory: "1g" },
      volumes: [
        {
          mountPath: engine === "postgres" ? "/var/lib/postgresql" : "/data",
          name: "data",
        },
      ],
    },
    health: { timeoutSeconds: 30, type: "container" },
    id: `primary-${engine}`,
    image:
      engine === "postgres"
        ? "postgres:18-alpine@sha256:fixture"
        : "redis:8-alpine@sha256:fixture",
    kind: engine,
    name: engine === "postgres" ? "Primary PostgreSQL" : "Primary Redis",
    secrets: {},
    server: "production",
    sharedSecrets: { build: [], deployment: [] },
    sourceBranch: "main",
  };
}

function restoreContext(engine: Engine): ResourceOperationExecutionContext {
  const release = {
    containerName: `towbar-${engine}`,
    imageTag: resourceFixture(engine).image,
    releaseId,
  };
  return {
    cleanupExpected: {
      containerNames: [],
      deployableIds: [],
      imageTags: [],
    },
    currentRelease: release,
    deployable: resourceFixture(engine),
    deployableId,
    operationId,
    retentionBackups: [],
    restoreBackup: {
      createdAt: "2026-08-30T08:00:00.000Z",
      id: backupId,
      result: {
        backupId,
        bucket: "towbar-fixture-backups",
        checksum,
        deletedBackupIds: [],
        encryption: "AES256",
        engine,
        engineMajorVersion: engine === "postgres" ? 18 : 8,
        format: engine === "postgres" ? "postgres-custom" : "redis-rdb",
        key: `fixtures/${engine}.backup`,
        metadataVersion: 1,
        region: "ap-south-1",
        sizeBytes: backupBody.length,
        verifiedAt: "2026-08-30T08:00:00.000Z",
        warnings: [],
      },
    },
    request: {
      backupId,
      reason: "Validate the managed recovery workflow",
      release,
      type: "restore",
    },
    server: {
      buildConcurrency: 4,
      ip: "192.0.2.10",
      secrets: { login: "aws:fixture/server/login" },
      ssh: { host: "192.0.2.10", port: 22, username: "deploy" },
    },
    sourceId,
    trustedHostKeys: [],
  };
}

function restoreSecrets(engine: Engine): ResourceOperationSecrets {
  return {
    aws: {
      accessKeyId: "fixture",
      region: "ap-south-1",
      secretAccessKey: "fixture",
    },
    login: { privateKey: "fixture" },
    runtime:
      engine === "postgres"
        ? { POSTGRES_DB: "towbar", POSTGRES_PASSWORD: "fixture" }
        : { REDIS_PASSWORD: "fixture" },
    sensitiveValues: ["fixture"],
  };
}

function storageFixture(failure: Failure): BackupStorage {
  return {
    async deleteObject() {},
    async download(input) {
      await writeFile(
        input.localPath,
        failure === "corrupt" ? Buffer.from("corrupt", "utf8") : backupBody,
      );
    },
    headObject() {
      return Promise.resolve({
        checksum,
        encryption: "AES256",
        engine: "postgres",
        engineMajorVersion: 18,
        exists: true,
        format: "postgres-custom",
        metadataVersion: 1,
        sizeBytes: backupBody.length,
      });
    },
    upload() {
      return Promise.resolve({});
    },
  };
}

function sessionFixture(engine: Engine, failure: Failure) {
  const commands: string[] = [];
  const session = {
    run(script: string) {
      commands.push(script);
      if (script === restoreScripts.preflight) {
        if (failure === "incompatible") {
          return Promise.reject(new Error("engine mismatch"));
        }
        if (failure === "insufficient_disk") {
          return Promise.reject(new Error("INSUFFICIENT_DISK"));
        }
        return Promise.resolve({
          stderr: "",
          stdout: `towbar-${deployableId}-data\n10737418240\n${engine === "postgres" ? 18 : 8}\n`,
        });
      }
      if (script === restoreScripts.restoreCandidate && failure === "health") {
        return Promise.reject(new Error("candidate health validation failed"));
      }
      if (script === restoreScripts.promote) {
        return Promise.resolve({
          stderr: "",
          stdout: failure === "rollback" ? "ROLLED_BACK\n" : "PROMOTED\n",
        });
      }
      return Promise.resolve({ stderr: "", stdout: "" });
    },
    async upload() {},
  } as unknown as SshSession;
  return { commands, session };
}

async function runRestoreFixture(engine: Engine, failure: Failure) {
  const directory = await mkdtemp(path.join(tmpdir(), "towbar-restore-test-"));
  const { commands, session } = sessionFixture(engine, failure);
  const baseStorage = storageFixture(failure);
  const storage: BackupStorage = {
    ...baseStorage,
    async headObject(input) {
      const metadata = await baseStorage.headObject(input);
      return {
        ...metadata,
        engine,
        engineMajorVersion: engine === "postgres" ? 18 : 8,
        format: engine === "postgres" ? "postgres-custom" : "redis-rdb",
      };
    },
  };
  try {
    const result = await executeManagedRestore({
      context: restoreContext(engine),
      hooks: {},
      localDirectory: directory,
      remoteDirectory: "/tmp/towbar-restore",
      secrets: restoreSecrets(engine),
      session,
      storage,
    });
    return { commands, result };
  } catch (error) {
    return { commands, error };
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

void describe("managed database restore scripts", () => {
  void it("preflights ownership, active volume, free disk, and engine compatibility", () => {
    assert.match(restoreScripts.preflight, /towbar\.managed/);
    assert.match(restoreScripts.preflight, /towbar\.deployable/);
    assert.match(restoreScripts.preflight, /df -PB1/);
    assert.match(restoreScripts.preflight, /backup_size \* 3/);
    assert.match(restoreScripts.preflight, /postgres --version/);
    assert.match(restoreScripts.preflight, /redis-server --version/);
  });

  void it("restores PostgreSQL and Redis only inside an isolated candidate", () => {
    assert.match(restoreScripts.restoreCandidate, /pg_restore/);
    assert.match(restoreScripts.restoreCandidate, /redis-check-rdb/);
    assert.match(restoreScripts.restoreCandidate, /psql.*SELECT 1/su);
    assert.match(restoreScripts.restoreCandidate, /redis-cli.*PING/su);
    assert.match(restoreScripts.prepareCandidate, /restore-candidate/);
  });

  for (const engine of ["PostgreSQL", "Redis"] as const) {
    void it(`${engine} exposes explicit corrupt-backup and health-failure gates`, () => {
      if (engine === "PostgreSQL") {
        assert.match(restoreScripts.restoreCandidate, /pg_restore/);
        assert.match(restoreScripts.restoreCandidate, /pg_isready/);
      } else {
        assert.match(restoreScripts.restoreCandidate, /redis-check-rdb/);
        assert.match(restoreScripts.restoreCandidate, /redis-cli.*PING/su);
      }
      assert.match(restoreScripts.restoreCandidate, /exit 68/);
    });

    void it(`${engine} refuses incompatible engine versions and insufficient disk`, () => {
      assert.match(restoreScripts.preflight, /actual_major/);
      assert.match(restoreScripts.preflight, /expected_major/);
      assert.match(restoreScripts.preflight, /INSUFFICIENT_DISK/);
      assert.match(restoreScripts.preflight, /exit 67/);
    });

    void it(`${engine} retains rollback data and supports bounded cleanup`, () => {
      assert.match(restoreScripts.promote, /ROLLED_BACK/);
      assert.match(restoreScripts.cleanup, /docker volume rm/);
    });
  }

  void it("switches the volume pointer only during non-cancellable promotion and rolls back", () => {
    assert.match(restoreScripts.promote, /switch_pointer "\$candidate_volume"/);
    assert.match(restoreScripts.promote, /switch_pointer "\$previous_volume"/);
    assert.match(restoreScripts.promote, /ROLLED_BACK/);
    assert.match(restoreScripts.promote, /ROLLBACK_FAILED/);
  });

  void it("never removes an active or unowned rollback volume", () => {
    assert.match(restoreScripts.cleanup, /grep -Fxq "\$volume"/);
    assert.match(restoreScripts.cleanup, /towbar\.managed/);
    assert.match(restoreScripts.cleanup, /towbar\.deployable/);
  });
});

for (const engine of ["postgres", "redis"] as const) {
  void describe(`${engine} managed restore fixture`, () => {
    void it("restores, validates, and promotes an isolated candidate", async () => {
      const execution = await runRestoreFixture(engine, null);
      assert.equal("error" in execution, false);
      assert.equal(execution.result?.outcome, "promoted");
      assert.equal(execution.result?.validation?.engine, engine);
      assert.equal(execution.commands.includes(restoreScripts.promote), true);
    });

    for (const failure of [
      "corrupt",
      "health",
      "incompatible",
      "insufficient_disk",
    ] as const) {
      void it(`keeps the active runtime untouched after ${failure}`, async () => {
        const execution = await runRestoreFixture(engine, failure);
        assert.equal(execution.error instanceof Error, true);
        if (failure === "corrupt" || failure === "health") {
          assert.equal(execution.error instanceof ManagedRestoreError, true);
          assert.equal(
            (execution.error as ManagedRestoreError).restoreResult.outcome,
            "candidate_failed",
          );
        }
        assert.equal(
          execution.commands.includes(restoreScripts.promote),
          false,
        );
      });
    }

    void it("reports a safe automatic rollback when promotion fails", async () => {
      const execution = await runRestoreFixture(engine, "rollback");
      assert.equal(execution.error instanceof ManagedRestoreError, true);
      assert.equal(
        (execution.error as ManagedRestoreError).restoreResult.outcome,
        "rolled_back",
      );
    });

    void it("cleans only the explicit retained rollback volumes", async () => {
      const volume = `towbar-${deployableId}-previous-data`;
      const context: ResourceOperationExecutionContext = {
        ...restoreContext(engine),
        request: {
          release: restoreContext(engine).currentRelease!,
          restoreId,
          type: "restore_cleanup",
          volumes: [volume],
        },
      };
      const session = {
        run(script: string, args: string[]) {
          assert.equal(script, restoreScripts.cleanup);
          assert.deepEqual(args, [deployableId, volume]);
          return Promise.resolve({
            stderr: "",
            stdout: JSON.stringify({ cleaned: [volume], skipped: [] }),
          });
        },
      } as unknown as SshSession;
      const result = await executeRestoreCleanup({ context, session });
      assert.deepEqual(result.cleanedVolumes, [volume]);
      assert.deepEqual(result.skippedVolumes, []);
    });
  });
}
