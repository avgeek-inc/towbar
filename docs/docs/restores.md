---
title: "Database restores"
description: "Validate a retained database backup, restore it in isolation, and promote it with rollback protection."
---

Towbar supports manual restores with validation and rollback protection for manifest-managed PostgreSQL
and Redis Resources that already use managed S3 backups. Restores are never
started automatically.

## Before a restore

A retained backup must be marked restore-ready on the Resource's **Settings →
Backups** page. Towbar continuously checks every retained object for:

- freshness relative to the declared backup schedule;
- S3 object existence and a plausible, matching size;
- matching SHA-256 checksum metadata;
- the declared AES-256 or AWS KMS encryption;
- matching database engine and major version; and
- the expected PostgreSQL custom or Redis RDB format.

Freshness reports whether the latest scheduled recovery point meets its RPO;
it does not invalidate an older retained backup whose object and compatibility
checks still pass. The UI can therefore show an older point as **Stale** while
still allowing an explicit, safety-gated restore.

The workspace AWS identity needs the existing backup write and retention
permissions plus `s3:GetObject` for the declared bucket/prefix. Versioned
objects also require access to the retained object version. The target Server
must be prepared, have a healthy current Resource release, use one Towbar-owned
database volume, and have free Docker storage of at least three times the
backup size (with a 1 GiB minimum).

## Restore flow

1. Select a restore-ready retained backup.
2. Enter an operator reason and type the Resource name exactly.
3. Towbar serializes the restore with deployment, backup, cleanup, and other
   work for the target Server.
4. Towbar downloads and verifies the object, creates an isolated candidate
   volume and container, restores it, and checks database readability and
   health.
5. Only after validation does Towbar atomically switch the stable active-volume
   pointer and recreate the managed runtime.
6. If promotion health fails, Towbar switches back to the previous volume and
   reports **Rolled back**. It never deletes that previous volume during
   promotion.

Cancellation is available while work is queued, downloading, verifying, or
restoring the candidate. Once promotion starts, Towbar must finish promotion or
rollback and the operation cannot be cancelled.

## Rollback retention and cleanup

After a successful promotion, the previous volume is retained for seven days.
An owner can remove it early from the restore history. The maintenance sweep
queues cleanup after the retention deadline. Cleanup rechecks Towbar ownership
labels and the active-volume pointer; an active, unowned, or missing volume is
skipped rather than removed.

## Audit and incident review

The restore history records the actor, operator reason, backup ID and metadata,
redacted phase commands, validation result, promotion or rollback outcome, and
cleanup result. Secret values and restored data are never written to the audit
trail. Restore, rollback, cancellation, and non-restorable backup transitions
also use the configured notification pipeline.

If a restore fails, read the final phase and message before retrying. Correct a
missing object, incompatible engine version, insufficient disk, credential
scope, or runtime health problem first. A candidate failure does not change the
active volume.

## Verify recovery

After the restore reaches its final state, check the resource's runtime health and connect with an application or database client to verify the expected recovery point. Review the retained previous volume and its cleanup deadline. Record the outcome in your recovery procedure before resuming normal writes or dependent operations.

For storage configuration and schedules, see [Database backups](/docs/backups). For unavailable objects or credentials, see [Troubleshooting](/docs/troubleshooting#backup-and-restore-problems).
