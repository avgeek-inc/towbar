import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { backupOperationResultSchema } from "@workspace/towbar-core";
import {
  resourceOperationInternal,
  resourceOperationScripts,
} from "./resource-operations.js";

void describe("Resource operation scripts", () => {
  void it("uses database-native archives and validates them before upload", () => {
    assert.match(resourceOperationScripts.createBackup, /pg_dump/);
    assert.match(resourceOperationScripts.createBackup, /pg_restore --list/);
    assert.match(resourceOperationScripts.createBackup, /redis-cli/);
    assert.match(resourceOperationScripts.createBackup, /redis-check-rdb/);
    assert.match(resourceOperationScripts.createBackup, /test -s/);
    assert.match(resourceOperationScripts.createBackup, /stat -c %s/);
  });

  void it("binds backup and runtime operations to the retained deployable", () => {
    for (const script of [
      resourceOperationScripts.createBackup,
      resourceOperationScripts.containerOperation,
    ]) {
      assert.match(script, /towbar\.managed/);
      assert.match(script, /towbar\.deployable/);
      assert.match(script, /towbar\.app/);
    }
  });

  void it("rechecks Source ownership and expected release state before cleanup", () => {
    assert.match(resourceOperationScripts.cleanupOrphans, /towbar\.source/);
    assert.match(resourceOperationScripts.cleanupOrphans, /towbar\.managed/);
    assert.match(resourceOperationScripts.cleanupOrphans, /containerNames/);
    assert.match(resourceOperationScripts.cleanupOrphans, /deployableIds/);
    assert.match(resourceOperationScripts.cleanupOrphans, /imageTags/);
    assert.doesNotMatch(
      resourceOperationScripts.cleanupOrphans,
      /system prune/,
    );
  });
});

void describe("buildBackupResult", () => {
  void it("produces valid schema for Azure-only backup without region", () => {
    const result = resourceOperationInternal.buildBackupResult({
      backup: {
        azureBlob: {
          container: "backups",
          prefix: "databases",
          storageAccount: "storageacct",
        },
        restoreFrom: "azureBlob",
        retention: { keepLast: 7 },
      },
      checksum:
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      deletedBackupIds: [],
      destinationResults: [
        {
          bucket: "backups",
          encryption: "Microsoft-managed",
          key: "databases/source-1/backup-1/dump.sql",
          provider: "azureBlob",
          storageAccount: "storageacct",
        },
      ],
      engine: "postgres",
      engineMajorVersion: 17,
      format: "postgres-custom",
      operationId: "31111111-1111-4111-8111-222222222222",
      sizeBytes: 1024,
      warnings: [],
    });

    const parsed = backupOperationResultSchema.parse(result);
    assert.equal(parsed.bucket, "backups");
    assert.equal(parsed.storageAccount, "storageacct");
    assert.equal(parsed.region, undefined);
    assert.equal(parsed.restoreFrom, "azureBlob");
  });

  void it("produces valid schema for GCS-only backup without region", () => {
    const result = resourceOperationInternal.buildBackupResult({
      backup: {
        gcs: {
          bucket: "gcs-bucket",
          prefix: "databases",
        },
        restoreFrom: "gcs",
        retention: { keepLast: 7 },
      },
      checksum:
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      deletedBackupIds: [],
      destinationResults: [
        {
          bucket: "gcs-bucket",
          encryption: "Google-managed",
          key: "databases/source-1/backup-1/dump.sql",
          provider: "gcs",
        },
      ],
      engine: "postgres",
      engineMajorVersion: 17,
      format: "postgres-custom",
      operationId: "31111111-1111-4111-8111-222222222222",
      sizeBytes: 1024,
      warnings: [],
    });

    const parsed = backupOperationResultSchema.parse(result);
    assert.equal(parsed.bucket, "gcs-bucket");
    assert.equal(parsed.region, undefined);
    assert.equal(parsed.restoreFrom, "gcs");
  });

  void it("produces valid schema for multi-destination backup with S3 region", () => {
    const result = resourceOperationInternal.buildBackupResult({
      backup: {
        gcs: {
          bucket: "gcs-bucket",
          prefix: "databases",
        },
        restoreFrom: "s3",
        retention: { keepLast: 7 },
        s3: {
          bucket: "s3-bucket",
          encryption: "AES256",
          prefix: "databases",
          region: "eu-central-1",
        },
      },
      checksum:
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      deletedBackupIds: [],
      destinationResults: [
        {
          bucket: "s3-bucket",
          encryption: "AES256",
          key: "databases/source-1/backup-1/dump.sql",
          provider: "s3",
          region: "eu-central-1",
        },
        {
          bucket: "gcs-bucket",
          encryption: "Google-managed",
          key: "databases/source-1/backup-1/dump.sql",
          provider: "gcs",
        },
      ],
      engine: "postgres",
      engineMajorVersion: 17,
      format: "postgres-custom",
      operationId: "31111111-1111-4111-8111-222222222222",
      region: "eu-central-1",
      sizeBytes: 1024,
      warnings: [],
    });

    const parsed = backupOperationResultSchema.parse(result);
    assert.equal(parsed.bucket, "s3-bucket");
    assert.equal(parsed.region, "eu-central-1");
    assert.equal(parsed.destinations?.length, 2);
  });
});

void describe("cleanupRetentionBackups", () => {
  void it("records deleted backup ID when all storages succeed", async () => {
    let deletedKey = "";
    const mockStorage = {
      deleteObject: (params: { key: string }) => {
        deletedKey = params.key;
        return Promise.resolve();
      },
      download: () => Promise.resolve(),
      headObject: () => Promise.resolve({ exists: true }),
      upload: () => Promise.resolve({}),
    };

    const result = await resourceOperationInternal.cleanupRetentionBackups(
      [
        {
          bucket: "test-bucket",
          id: "31111111-1111-4111-8111-333333333333",
          key: "backup-key",
        },
      ],
      ["s3"],
      { s3: mockStorage },
    );

    assert.deepEqual(result.deletedBackupIds, [
      "31111111-1111-4111-8111-333333333333",
    ]);
    assert.equal(deletedKey, "backup-key");
    assert.equal(result.warnings.length, 0);
  });

  void it("emits warning and deletes ID when at least one destination succeeds", async () => {
    const mockSucceedStorage = {
      deleteObject: () => Promise.resolve(),
      download: () => Promise.resolve(),
      headObject: () => Promise.resolve({ exists: true }),
      upload: () => Promise.resolve({}),
    };
    const mockFailStorage = {
      deleteObject: () => Promise.reject(new Error("Network timeout")),
      download: () => Promise.resolve(),
      headObject: () => Promise.resolve({ exists: true }),
      upload: () => Promise.resolve({}),
    };

    const result = await resourceOperationInternal.cleanupRetentionBackups(
      [
        {
          bucket: "test-bucket",
          destinations: [
            {
              bucket: "s3-bucket",
              key: "key-1",
              provider: "s3",
            },
            {
              bucket: "gcs-bucket",
              key: "key-1",
              provider: "gcs",
            },
          ],
          id: "31111111-1111-4111-8111-333333333333",
          key: "key-1",
        },
      ],
      ["s3", "gcs"],
      { gcs: mockFailStorage, s3: mockSucceedStorage },
    );

    assert.deepEqual(result.deletedBackupIds, [
      "31111111-1111-4111-8111-333333333333",
    ]);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0]!, /partial destination failures/);
  });

  void it("emits warning and does not delete ID when all storages fail", async () => {
    const mockFailStorage = {
      deleteObject: () => Promise.reject(new Error("Access denied")),
      download: () => Promise.resolve(),
      headObject: () => Promise.resolve({ exists: true }),
      upload: () => Promise.resolve({}),
    };

    const result = await resourceOperationInternal.cleanupRetentionBackups(
      [
        {
          bucket: "test-bucket",
          id: "31111111-1111-4111-8111-333333333333",
          key: "backup-key",
        },
      ],
      ["s3"],
      { s3: mockFailStorage },
    );

    assert.deepEqual(result.deletedBackupIds, []);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0]!, /could not delete backup/);
  });
});
