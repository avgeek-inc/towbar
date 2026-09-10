import assert from "node:assert/strict";
import { test } from "node:test";
import { resourceOperationInternal } from "./resource-operations.js";
import type { BackupStorage } from "./types.js";

const storage: BackupStorage = {
  deleteObject: async () => {},
  download: async () => {},
  upload: () => Promise.resolve({}),
  headObject: () => Promise.resolve({ exists: true }),
};
void test("retention keeps missing destinations eligible for cleanup and completes on retry", async () => {
  const candidate = {
    id: "backup",
    bucket: "s3-backups",
    key: "dump",
    destinations: [
      { provider: "s3" as const, bucket: "s3-backups", key: "dump" },
      { provider: "gcs" as const, bucket: "gcs-backups", key: "dump" },
    ],
  };
  const first = await resourceOperationInternal.cleanupRetentionBackups(
    [candidate],
    ["s3"],
    { s3: storage },
  );
  assert.deepEqual(first.deletedBackupIds, []);
  assert.equal(first.warnings.length, 1);
  const retry = await resourceOperationInternal.cleanupRetentionBackups(
    [candidate],
    ["s3", "gcs"],
    { s3: storage, gcs: storage },
  );
  assert.deepEqual(retry.deletedBackupIds, [candidate.id]);
  assert.deepEqual(retry.warnings, []);
});
void test("GCS upload records verified CMEK encryption for assurance and restore", async () => {
  const result = await resourceOperationInternal.uploadAndVerifyDestination({
    checksum: "abc",
    config: {
      bucket: "gcs-backups",
      key: "dump",
      encryption: "Google-managed",
      kmsKeyId: undefined,
      region: undefined,
      storageAccount: undefined,
    },
    engine: "postgres",
    engineMajorVersion: 17,
    format: "postgres-custom",
    localPath: "/unused",
    provider: "gcs",
    sizeBytes: 10,
    storage: {
      ...storage,
      headObject: () =>
        Promise.resolve({
          exists: true,
          checksum: "abc",
          engine: "postgres",
          engineMajorVersion: 17,
          format: "postgres-custom",
          sizeBytes: 10,
          metadataVersion: 1,
          encryption: "Google-CMEK",
        }),
    },
  });
  assert.equal(result.encryption, "Google-CMEK");
});
