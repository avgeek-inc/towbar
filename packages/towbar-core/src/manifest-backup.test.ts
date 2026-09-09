import assert from "node:assert/strict";
import test from "node:test";

import {
  ManifestValidationError,
  parseDeploymentManifest,
} from "./manifest.js";

const manifest = `
version: 1
source:
  branch: release
`;

void test("normalizes managed backups and rejects unsafe declarations", () => {
  const parsed = parseDeploymentManifest(
    `${manifest}\nresources:\n  - id: database\n    name: Database\n    type: postgres\n    server: 203.0.113.10\n    backup:\n      s3:\n        bucket: example-production-backups\n        encryption: aws:kms\n        kmsKeyId: alias/towbar-backups\n`,
  ).manifest;
  const resource = parsed.resources?.[0];
  assert.ok(resource);
  assert.equal(resource.backup?.s3?.encryption, "aws:kms");
  assert.equal(resource.backup?.s3?.kmsKeyId, "alias/towbar-backups");
  assert.equal(resource.backup?.restoreFrom, "s3");

  assert.throws(
    () =>
      parseDeploymentManifest(
        `${manifest}\nresources:\n  - id: metrics\n    name: Metrics\n    type: image\n    image: prom/prometheus:v3.5.0\n    server: 203.0.113.10\n    backup:\n      s3:\n        bucket: example-production-backups\n`,
      ),
    ManifestValidationError,
  );
  assert.throws(
    () =>
      parseDeploymentManifest(
        `${manifest}\nresources:\n  - id: database\n    name: Database\n    type: postgres\n    server: 203.0.113.10\n    backup:\n      s3:\n        bucket: example-production-backups\n        encryption: aws:kms\n`,
      ),
    ManifestValidationError,
  );
});

void test("normalizes GCS, Azure Blob, and multi-destination backups", () => {
  const gcsManifest = parseDeploymentManifest(
    `${manifest}\nresources:\n  - id: database\n    name: Database\n    type: postgres\n    server: 203.0.113.10\n    backup:\n      gcs:\n        bucket: my-gcs-backups\n        prefix: db\n        region: us-central1\n`,
  ).manifest;
  const gcsResource = gcsManifest.resources?.[0];
  assert.ok(gcsResource);
  assert.equal(gcsResource.backup?.restoreFrom, "gcs");
  assert.equal(gcsResource.backup?.gcs?.bucket, "my-gcs-backups");
  assert.equal(gcsResource.backup?.gcs?.prefix, "db");
  assert.equal(gcsResource.backup?.gcs?.region, "us-central1");

  const azureManifest = parseDeploymentManifest(
    `${manifest}\nresources:\n  - id: database\n    name: Database\n    type: postgres\n    server: 203.0.113.10\n    backup:\n      azureBlob:\n        storageAccount: myaccount\n        container: backups\n`,
  ).manifest;
  const azureResource = azureManifest.resources?.[0];
  assert.ok(azureResource);
  assert.equal(azureResource.backup?.restoreFrom, "azureBlob");
  assert.equal(azureResource.backup?.azureBlob?.storageAccount, "myaccount");
  assert.equal(azureResource.backup?.azureBlob?.container, "backups");
  assert.equal(azureResource.backup?.azureBlob?.prefix, "towbar");

  const multiManifest = parseDeploymentManifest(
    `${manifest}\nresources:\n  - id: database\n    name: Database\n    type: postgres\n    server: 203.0.113.10\n    backup:\n      restoreFrom: gcs\n      s3:\n        bucket: s3-backups\n      gcs:\n        bucket: gcs-backups\n`,
  ).manifest;
  const multiResource = multiManifest.resources?.[0];
  assert.ok(multiResource);
  assert.equal(multiResource.backup?.restoreFrom, "gcs");
  assert.equal(multiResource.backup?.s3?.bucket, "s3-backups");
  assert.equal(multiResource.backup?.gcs?.bucket, "gcs-backups");

  // Rejects multiple destinations without restoreFrom
  assert.throws(
    () =>
      parseDeploymentManifest(
        `${manifest}\nresources:\n  - id: database\n    name: Database\n    type: postgres\n    server: 203.0.113.10\n    backup:\n      s3:\n        bucket: s3-backups\n      gcs:\n        bucket: gcs-backups\n`,
      ),
    ManifestValidationError,
  );

  // Rejects restoreFrom referencing undeclared destination
  assert.throws(
    () =>
      parseDeploymentManifest(
        `${manifest}\nresources:\n  - id: database\n    name: Database\n    type: postgres\n    server: 203.0.113.10\n    backup:\n      restoreFrom: azureBlob\n      s3:\n        bucket: s3-backups\n`,
      ),
    ManifestValidationError,
  );

  // Rejects empty backup destination block
  assert.throws(
    () =>
      parseDeploymentManifest(
        `${manifest}\nresources:\n  - id: database\n    name: Database\n    type: postgres\n    server: 203.0.113.10\n    backup:\n      retention:\n        keepLast: 5\n`,
      ),
    ManifestValidationError,
  );
});
