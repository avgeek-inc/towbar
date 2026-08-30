import { z } from "zod";

export const backupAssuranceCheckNames = [
  "freshness",
  "object_exists",
  "size",
  "checksum",
  "encryption",
  "engine",
  "format",
] as const;

export const backupAssuranceCheckSchema = z
  .object({
    message: z.string().trim().min(1).max(500),
    name: z.enum(backupAssuranceCheckNames),
    passed: z.boolean(),
  })
  .strict();

export const backupAssuranceStatusSchema = z.enum([
  "missing",
  "stale",
  "not_restore_ready",
  "restore_ready",
]);
export type BackupAssuranceStatus = z.infer<typeof backupAssuranceStatusSchema>;

export const backupAssuranceSchema = z
  .object({
    backupId: z.string().uuid().nullable(),
    checkedAt: z.string().datetime(),
    checks: z.array(backupAssuranceCheckSchema).length(7),
    restoreReady: z.boolean(),
    status: backupAssuranceStatusSchema,
  })
  .strict();

export type BackupAssurance = z.infer<typeof backupAssuranceSchema>;
export type BackupAssuranceCheck = z.infer<typeof backupAssuranceCheckSchema>;

type BackupMetadata = {
  checksum?: string;
  createdAt: Date;
  encryption?: "AES256" | "aws:kms";
  engine?: "postgres" | "redis";
  engineMajorVersion?: number;
  format?: "postgres-custom" | "redis-rdb";
  id: string;
  metadataVersion?: 1;
  sizeBytes?: number;
};

type BackupObjectMetadata = {
  checksum?: string;
  encryption?: "AES256" | "aws:kms";
  engine?: "postgres" | "redis";
  engineMajorVersion?: number;
  error?: "access_denied" | "unavailable";
  exists: boolean;
  format?: "postgres-custom" | "redis-rdb";
  metadataVersion?: number;
  sizeBytes?: number;
};

type BackupAssuranceInput = {
  backup: BackupMetadata | null;
  expectedEngine: "postgres" | "redis";
  object: BackupObjectMetadata | null;
  staleAfter: Date | null;
  checkedAt?: Date;
};

function check(
  name: BackupAssuranceCheck["name"],
  passed: boolean,
  success: string,
  failure: string,
): BackupAssuranceCheck {
  return { message: passed ? success : failure, name, passed };
}

function objectExistsCheck(
  backup: BackupMetadata | null,
  object: BackupObjectMetadata | null,
): BackupAssuranceCheck {
  const passed = Boolean(backup && object?.exists);
  let failure = "S3 object is missing";
  if (object?.error === "access_denied") {
    failure = "Source AWS credentials cannot access the S3 object";
  } else if (object?.error === "unavailable") {
    failure = "S3 object verification is temporarily unavailable";
  }
  return check("object_exists", passed, "S3 object exists", failure);
}

function engineCheck(
  backup: BackupMetadata | null,
  object: BackupObjectMetadata | null,
  expectedEngine: BackupAssuranceInput["expectedEngine"],
): BackupAssuranceCheck {
  const passed = Boolean(
    backup?.metadataVersion === 1 &&
    object?.metadataVersion === 1 &&
    backup.engine === expectedEngine &&
    object.engine === expectedEngine &&
    backup.engineMajorVersion &&
    backup.engineMajorVersion === object.engineMajorVersion,
  );
  return check(
    "engine",
    passed,
    "Engine and major version metadata match",
    "Engine or major version metadata is incompatible",
  );
}

function buildChecks(input: BackupAssuranceInput): BackupAssuranceCheck[] {
  const { backup, object } = input;
  const fresh = Boolean(
    backup && (!input.staleAfter || backup.createdAt >= input.staleAfter),
  );
  const plausibleSize = Boolean(
    backup &&
    object?.sizeBytes &&
    object.sizeBytes > 0 &&
    backup.sizeBytes === object.sizeBytes,
  );
  const checksumMatches = Boolean(
    backup?.checksum && object?.checksum && backup.checksum === object.checksum,
  );
  const encryptionMatches = Boolean(
    backup?.encryption &&
    object?.encryption &&
    backup.encryption === object.encryption,
  );
  const expectedFormat =
    input.expectedEngine === "postgres" ? "postgres-custom" : "redis-rdb";
  const formatMatches = Boolean(
    backup?.format === expectedFormat && object?.format === expectedFormat,
  );
  return [
    check(
      "freshness",
      fresh,
      "Backup is within its freshness window",
      "Backup is stale or missing",
    ),
    objectExistsCheck(backup, object),
    check(
      "size",
      plausibleSize,
      "Object size matches backup metadata",
      "Object size is empty or does not match",
    ),
    check(
      "checksum",
      checksumMatches,
      "Checksum metadata matches",
      "Checksum metadata is missing or does not match",
    ),
    check(
      "encryption",
      encryptionMatches,
      "Encryption metadata matches",
      "Encryption metadata is missing or does not match",
    ),
    engineCheck(backup, object, input.expectedEngine),
    check(
      "format",
      formatMatches,
      "Backup format is restorable",
      "Backup format metadata is incompatible",
    ),
  ];
}

function assuranceStatus(input: {
  backup: BackupMetadata | null;
  fresh: boolean;
  restoreReady: boolean;
}): BackupAssuranceStatus {
  if (!input.backup) return "missing";
  if (!input.fresh) return "stale";
  return input.restoreReady ? "restore_ready" : "not_restore_ready";
}

export function evaluateBackupAssurance(
  input: BackupAssuranceInput,
): BackupAssurance {
  const checkedAt = input.checkedAt ?? new Date();
  const backup = input.backup;
  const checks = buildChecks(input);
  const fresh = checks[0]?.passed ?? false;
  // Freshness measures whether the backup policy is meeting its RPO. It does
  // not make an older retained recovery point structurally unsafe to restore.
  const restoreReady = checks
    .filter((check) => check.name !== "freshness")
    .every((check) => check.passed);
  const status = assuranceStatus({ backup, fresh, restoreReady });
  return {
    backupId: backup?.id ?? null,
    checkedAt: checkedAt.toISOString(),
    checks,
    restoreReady,
    status,
  };
}
