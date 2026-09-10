import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeDeploymentManifest } from "@workspace/towbar-core";
import { initializeBackupStorages } from "./resource-operation.js";

const deployable = normalizeDeploymentManifest({
  version: 1,
  resources: [
    {
      id: "db",
      type: "postgres",
      name: "Database",
      server: "203.0.113.10",
      backup: {
        s3: { bucket: "s3-backups", region: "us-west-2" },
        gcs: { bucket: "gcs-backups" },
        azureBlob: { container: "backups", storageAccount: "storageacct" },
        restoreFrom: "azureBlob",
      },
    },
  ],
}).resources![0]!;
const secrets = {
  aws: {
    accessKeyId: "test-key",
    secretAccessKey: "test-secret",
    region: "us-east-1",
  },
  gcp: { projectId: "test", serviceAccountKey: "{}" },
  azure: { clientId: "test", clientSecret: "test", tenantId: "test" },
};

void test("retained provider wins over every current manifest provider", async () => {
  for (const current of ["s3", "gcs", "azureBlob"] as const) {
    for (const recorded of ["s3", "gcs", "azureBlob", undefined] as const) {
      const selected = initializeBackupStorages(
        {
          deployable: {
            ...deployable,
            backup: { ...deployable.backup!, restoreFrom: current },
          },
          request: { type: "restore" } as Parameters<
            typeof initializeBackupStorages
          >[0]["request"],
          restoreBackup: {
            id: "backup",
            createdAt: "2026-09-10",
            result: {
              restoreFrom: recorded,
              region: "eu-west-1",
            } as NonNullable<
              Parameters<typeof initializeBackupStorages>[0]["restoreBackup"]
            >["result"],
          },
        },
        secrets,
      );
      try {
        assert.equal(selected.storage, selected.storages[recorded ?? "s3"]);
        if (!recorded || recorded === "s3")
          assert.equal(await selected.client!.config.region(), "eu-west-1");
      } finally {
        selected.client?.destroy();
      }
    }
  }
});

void test("missing retained provider credentials never fall back to another cloud", () => {
  const selected = initializeBackupStorages(
    {
      deployable,
      request: { type: "restore" } as Parameters<
        typeof initializeBackupStorages
      >[0]["request"],
      restoreBackup: {
        id: "backup",
        createdAt: "2026-09-10",
        result: { restoreFrom: "gcs" } as NonNullable<
          Parameters<typeof initializeBackupStorages>[0]["restoreBackup"]
        >["result"],
      },
    },
    { ...secrets, gcp: null },
  );
  try {
    assert.equal(selected.storage, undefined);
  } finally {
    selected.client?.destroy();
  }
});
