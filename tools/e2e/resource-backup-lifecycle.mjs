import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { executeResourceOperation } from "../../packages/towbar-deployer/dist/index.js";

export async function runBackupLifecycle({
  target,
  server,
  trustedHostKeys,
  sourceId,
  instances,
  redis,
}) {
  const instance = instances.get("staging");
  const objects = new Map();
  let corruptDownload = false;
  const storage = {
    async upload(input) {
      const bytes = await readFile(input.localPath);
      assert.equal(bytes.length, input.sizeBytes);
      assert.equal(
        createHash("sha256").update(bytes).digest("hex"),
        input.metadata["towbar-checksum"],
      );
      objects.set(input.key, { bytes, input });
      return { versionId: "test-version" };
    },
    async headObject({ key }) {
      const object = objects.get(key);
      if (!object) return { exists: false };
      const metadata = object.input.metadata;
      return {
        exists: true,
        checksum: metadata["towbar-checksum"],
        sizeBytes: object.bytes.length,
        engine: metadata["towbar-engine"],
        engineMajorVersion: Number(metadata["towbar-engine-major-version"]),
        format: metadata["towbar-format"],
        metadataVersion: Number(metadata["towbar-metadata-version"]),
        encryption: object.input.encryption,
      };
    },
    async download({ key, localPath }) {
      const object = objects.get(key);
      assert(object, "Backup object must exist");
      await writeFile(
        localPath,
        corruptDownload ? Buffer.from("corrupt") : object.bytes,
      );
    },
    async deleteObject({ key }) {
      objects.delete(key);
    },
  };
  const deployable = {
    ...instance.app,
    backup: {
      restoreFrom: "s3",
      retention: { keepLast: 7 },
      s3: {
        bucket: "test-backups",
        prefix: "databases",
        encryption: "AES256",
        region: "us-east-1",
      },
    },
  };
  const context = {
    cleanupExpected: { containerNames: [], deployableIds: [], imageTags: [] },
    currentRelease: {
      ...instance.current,
      releaseId: instance.current.releaseId ?? randomUUID(),
    },
    deployable,
    deployableId: instance.id,
    operationId: randomUUID(),
    retentionBackups: [],
    restoreBackup: null,
    request: { type: "backup" },
    sourceId,
    server,
    trustedHostKeys,
  };
  const secrets = {
    aws: null,
    azure: null,
    gcp: null,
    login: { privateKey: await readFile(target.key, "utf8") },
    runtime: { REDIS_PASSWORD: "test-staging" },
    sensitiveValues: ["test-staging"],
  };
  const result = await executeResourceOperation({ context, secrets, storage });
  assert.equal(result.engine, "redis");
  assert.equal(result.format, "redis-rdb");
  assert.equal(objects.size, 1);
  assert.equal(redis("staging", "SET environment staging-after-backup"), "OK");
  const restoreContext = {
    ...context,
    operationId: randomUUID(),
    request: { type: "restore", backupId: context.operationId },
    restoreBackup: {
      id: context.operationId,
      createdAt: new Date().toISOString(),
      result,
    },
  };
  corruptDownload = true;
  await assert.rejects(
    executeResourceOperation({ context: restoreContext, secrets, storage }),
    /checksum or size/,
  );
  assert.equal(redis("staging", "GET environment"), "staging-after-backup");
  assert.equal(redis("production", "GET environment"), "production-data");
  corruptDownload = false;
  const phases = [];
  const restored = await executeResourceOperation({
    context: { ...restoreContext, operationId: randomUUID() },
    secrets,
    storage,
    hooks: {
      progress: async ({ phase }) => {
        phases.push(phase);
        console.log(`restore: ${phase}`);
      },
    },
  });
  assert.equal(restored.outcome, "promoted");
  assert.equal(redis("staging", "GET environment"), "staging-data");
  assert.equal(redis("production", "GET environment"), "production-data");
  for (const phase of [
    "downloading_backup",
    "verifying_backup",
    "restoring_candidate",
    "promoting",
    "verifying_promotion",
  ])
    assert(phases.includes(phase));
  assert.equal(restored.previousVolumes.length, 1);
  assert.notEqual(
    restored.activeVolumes[0].volumeName,
    restored.previousVolumes[0].volumeName,
  );
  assert.equal(
    target.ssh(
      `docker inspect --format '{{index .Config.Labels "towbar.deployable"}}' ${instance.current.containerName}`,
    ),
    instance.id,
  );
  assert.equal(target.ssh(`docker ps -aq --filter name=^/towbar-restore-`), "");
  console.log(
    "Redis backup export, archive transfer, checksum rejection and full candidate import/promotion preserve sibling environment data.",
  );
}
