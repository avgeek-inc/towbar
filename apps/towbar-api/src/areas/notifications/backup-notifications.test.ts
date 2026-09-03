import assert from "node:assert/strict";
import test from "node:test";

import {
  backupFailedNotificationCopy,
  backupNotRestorableNotificationCopy,
  backupStaleNotificationCopy,
  shouldEmitBackupNotRestorableNotification,
} from "./backup-notifications.js";

void test("uses plain language for backup failures", () => {
  const copy = backupFailedNotificationCopy("Internal PostgreSQL");

  assert.equal(copy.title, "Backup failed");
  assert.match(copy.message, /could not complete/u);
  assert.doesNotMatch(copy.message, /UnknownError|RESOURCE_OPERATION_FAILED/u);
});

void test("describes a missed schedule without an internal field name", () => {
  assert.deepEqual(
    backupStaleNotificationCopy(
      "Internal PostgreSQL",
      new Date("2026-09-03T02:00:00.000Z"),
    ),
    {
      details: { scheduled_for: "3 Sep 2026 at 02:00 UTC" },
      message:
        "Towbar did not finish the scheduled backup for Internal PostgreSQL. Check the latest backup attempt in Towbar.",
      title: "Scheduled backup did not complete",
    },
  );
});

void test("keeps restore-readiness failures separate from stale reminders", () => {
  assert.equal(
    shouldEmitBackupNotRestorableNotification("not_restore_ready", undefined),
    true,
  );
  assert.equal(
    shouldEmitBackupNotRestorableNotification(
      "not_restore_ready",
      "not_restore_ready",
    ),
    false,
  );
  assert.equal(
    shouldEmitBackupNotRestorableNotification("stale", "restore_ready"),
    false,
  );
});

void test("uses plain language for restore-readiness failures", () => {
  const copy = backupNotRestorableNotificationCopy("Internal PostgreSQL");

  assert.equal(copy.title, "Backup cannot be verified");
  assert.match(copy.message, /safe to restore/u);
  assert.doesNotMatch(copy.message, /assurance|not.restore.ready/u);
});
