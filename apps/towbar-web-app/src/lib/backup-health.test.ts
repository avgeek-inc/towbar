import assert from "node:assert/strict";
import test from "node:test";

import type { BackupAssurance } from "@workspace/towbar-web-client";

import { getBackupHealth } from "./backup-health";

const passingChecks: BackupAssurance["checks"] = [
  { message: "Fresh", name: "freshness", passed: true },
  { message: "Exists", name: "object_exists", passed: true },
  { message: "Sized", name: "size", passed: true },
  { message: "Checksum", name: "checksum", passed: true },
  { message: "Encrypted", name: "encryption", passed: true },
  { message: "Engine", name: "engine", passed: true },
  { message: "Format", name: "format", passed: true },
];

const healthyAssurance: BackupAssurance = {
  backupOperationId: "backup-1",
  checkedAt: "2026-09-03T02:10:00.000Z",
  checks: passingChecks,
  resourceId: "resource-1",
  restoreReady: true,
  status: "restore_ready",
  updatedAt: "2026-09-03T02:10:00.000Z",
};

void test("shows the successful backup state machine", () => {
  assert.deepEqual(
    getBackupHealth({
      assurance: healthyAssurance,
      latestBackup: { id: "backup-1" },
      latestOperation: { errorMessage: null, state: "succeeded" },
    }),
    {
      description:
        "The latest backup is stored, verified, and ready to restore.",
      label: "Healthy",
      stages: [
        {
          description: "Towbar completed the backup.",
          label: "Backup run",
          status: "Complete",
          tone: "success",
        },
        {
          description: "The saved backup file is readable.",
          label: "S3 copy",
          status: "Verified",
          tone: "success",
        },
        {
          description: "The saved backup is ready to restore.",
          label: "Restore check",
          status: "Ready",
          tone: "success",
        },
      ],
      title: "Backup is healthy",
      tone: "success",
    },
  );
});

void test("translates an S3 access failure into an actionable health state", () => {
  const assurance = {
    ...healthyAssurance,
    checks: passingChecks.map((check) =>
      check.name === "object_exists"
        ? {
            ...check,
            message: "Workspace AWS credentials cannot access the S3 object",
            passed: false,
          }
        : check,
    ),
    restoreReady: false,
    status: "not_restore_ready" as const,
  };
  const health = getBackupHealth({
    assurance,
    latestBackup: { id: "backup-1" },
    latestOperation: { errorMessage: null, state: "succeeded" },
  });

  assert.equal(health.title, "Backup cannot be verified");
  assert.equal(
    health.description,
    "Towbar cannot read the saved file. Check the workspace AWS permissions.",
  );
  assert.deepEqual(
    health.stages.map((stage) => [stage.label, stage.status]),
    [
      ["Backup run", "Complete"],
      ["S3 copy", "Cannot verify"],
      ["Restore check", "Not ready"],
    ],
  );
});

void test("shows a failed run without exposing an internal error", () => {
  const health = getBackupHealth({
    assurance: healthyAssurance,
    latestBackup: { id: "backup-1" },
    latestOperation: { errorMessage: "UnknownError", state: "failed" },
  });

  assert.equal(health.title, "Backup failed");
  assert.equal(health.label, "Needs attention");
  assert.doesNotMatch(health.description, /UnknownError/u);
  assert.equal(health.stages[0]?.status, "Failed");
});

void test("shows an empty state before the first backup", () => {
  const health = getBackupHealth({});

  assert.equal(health.title, "No backup yet");
  assert.deepEqual(
    health.stages.map((stage) => stage.status),
    ["Not started", "Waiting", "Waiting"],
  );
});
