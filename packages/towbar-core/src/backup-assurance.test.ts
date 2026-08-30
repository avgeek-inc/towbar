import assert from "node:assert/strict";
import { test } from "node:test";

import { evaluateBackupAssurance } from "./backup-assurance.js";

const backup = {
  checksum: "a".repeat(64),
  createdAt: new Date("2026-08-30T08:00:00.000Z"),
  encryption: "AES256" as const,
  engine: "postgres" as const,
  engineMajorVersion: 18,
  format: "postgres-custom" as const,
  id: "11111111-1111-4111-8111-111111111111",
  metadataVersion: 1 as const,
  sizeBytes: 1_024,
};

const object = {
  checksum: backup.checksum,
  encryption: backup.encryption,
  engine: backup.engine,
  engineMajorVersion: backup.engineMajorVersion,
  exists: true,
  format: backup.format,
  metadataVersion: 1,
  sizeBytes: backup.sizeBytes,
};

for (const engine of ["postgres", "redis"] as const) {
  void test(`marks a fully verified ${engine} backup restore-ready`, () => {
    const format: "postgres-custom" | "redis-rdb" =
      engine === "postgres" ? "postgres-custom" : "redis-rdb";
    const candidate = { ...backup, engine, format };
    const result = evaluateBackupAssurance({
      backup: candidate,
      checkedAt: new Date("2026-08-30T09:00:00.000Z"),
      expectedEngine: engine,
      object: { ...object, engine, format },
      staleAfter: new Date("2026-08-30T07:00:00.000Z"),
    });
    assert.equal(result.status, "restore_ready");
    assert.equal(result.restoreReady, true);
    assert.equal(
      result.checks.every((check) => check.passed),
      true,
    );
  });
}

void test("distinguishes stale and non-restorable backups", () => {
  const stale = evaluateBackupAssurance({
    backup,
    expectedEngine: "postgres",
    object,
    staleAfter: new Date("2026-08-30T08:30:00.000Z"),
  });
  assert.equal(stale.status, "stale");
  assert.equal(stale.restoreReady, true);
  const corrupt = evaluateBackupAssurance({
    backup,
    expectedEngine: "postgres",
    object: { ...object, checksum: "b".repeat(64) },
    staleAfter: null,
  });
  assert.equal(corrupt.status, "not_restore_ready");
  assert.equal(
    corrupt.checks.find((check) => check.name === "checksum")?.passed,
    false,
  );
});

void test("rejects incompatible engine metadata", () => {
  const result = evaluateBackupAssurance({
    backup,
    expectedEngine: "redis",
    object,
    staleAfter: null,
  });
  assert.equal(result.restoreReady, false);
  assert.equal(result.status, "not_restore_ready");
});

void test("reports Source credential access failures without calling the object missing", () => {
  const result = evaluateBackupAssurance({
    backup,
    expectedEngine: "postgres",
    object: { error: "access_denied", exists: false },
    staleAfter: null,
  });
  assert.equal(result.status, "not_restore_ready");
  assert.match(
    result.checks.find((check) => check.name === "object_exists")!.message,
    /credentials cannot access/u,
  );
});

for (const failure of [
  { field: "exists", object: { ...object, exists: false } },
  { field: "size", object: { ...object, sizeBytes: 0 } },
  { field: "encryption", object: { ...object, encryption: undefined } },
  { field: "format", object: { ...object, format: "redis-rdb" as const } },
] as const) {
  void test(`fails restore assurance when ${failure.field} metadata is invalid`, () => {
    const result = evaluateBackupAssurance({
      backup,
      expectedEngine: "postgres",
      object: failure.object,
      staleAfter: null,
    });
    assert.equal(result.restoreReady, false);
    assert.equal(result.status, "not_restore_ready");
  });
}
