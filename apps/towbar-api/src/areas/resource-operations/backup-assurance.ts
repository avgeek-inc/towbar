import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { and, desc, eq, isNull, ne } from "drizzle-orm";

import {
  backupOperationResultSchema,
  evaluateBackupAssurance,
  getLatestBackupScheduleOccurrence,
  isNormalizedResource,
} from "@workspace/towbar-core";
import {
  apps,
  resourceBackupAssurances,
  resourceOperations,
} from "@workspace/towbar-database/schema";

import { getTowbarDatabase } from "../../infrastructure/database.js";
import { getDecryptedAwsCredential } from "../aws/service.js";
import { shouldEmitBackupNotRestorableNotification } from "../notifications/backup-notifications.js";
import { emitBackupAssuranceNotification } from "../notifications/events.js";

import type {
  BackupAssurance,
  BackupOperationResult,
} from "@workspace/towbar-core";

type AssuredObject = Parameters<typeof evaluateBackupAssurance>[0]["object"];

async function inspectBackupObject(input: {
  result: BackupOperationResult | null;
  sourceId: string;
  workspaceId: string;
}): Promise<AssuredObject> {
  if (!input.result) return null;
  const credential = await getDecryptedAwsCredential({
    sourceId: input.sourceId,
    workspaceId: input.workspaceId,
  });
  const client = new S3Client({
    credentials: {
      accessKeyId: credential.payload.accessKeyId,
      secretAccessKey: credential.payload.secretAccessKey,
    },
    region: input.result.region,
  });
  try {
    const head = await client.send(
      new HeadObjectCommand({
        Bucket: input.result.bucket,
        Key: input.result.key,
        ...(input.result.objectVersionId
          ? { VersionId: input.result.objectVersionId }
          : {}),
      }),
    );
    const metadata = head.Metadata ?? {};
    return {
      checksum: metadata["towbar-checksum"],
      encryption:
        head.ServerSideEncryption === "aws:kms"
          ? "aws:kms"
          : head.ServerSideEncryption === "AES256"
            ? "AES256"
            : undefined,
      engine:
        metadata["towbar-engine"] === "postgres" ||
        metadata["towbar-engine"] === "redis"
          ? metadata["towbar-engine"]
          : undefined,
      engineMajorVersion: parsePositiveInteger(
        metadata["towbar-engine-major-version"],
      ),
      exists: true,
      format:
        metadata["towbar-format"] === "postgres-custom" ||
        metadata["towbar-format"] === "redis-rdb"
          ? metadata["towbar-format"]
          : undefined,
      metadataVersion: parsePositiveInteger(
        metadata["towbar-metadata-version"],
      ),
      sizeBytes: head.ContentLength,
    };
  } catch (error) {
    const failure = classifyS3HeadFailure(error);
    return { ...(failure ? { error: failure } : {}), exists: false };
  } finally {
    client.destroy();
  }
}

async function persistBackupAssurance(input: {
  assurance: BackupAssurance;
  now: Date;
  resourceId: string;
}) {
  const { assurance, now, resourceId } = input;
  const [previous] = await getTowbarDatabase()
    .select({ status: resourceBackupAssurances.status })
    .from(resourceBackupAssurances)
    .where(
      eq(
        resourceBackupAssurances.backupOperationId,
        assurance.backupId ?? "00000000-0000-0000-0000-000000000000",
      ),
    )
    .limit(1);
  if (assurance.backupId) {
    await getTowbarDatabase()
      .insert(resourceBackupAssurances)
      .values({
        backupOperationId: assurance.backupId,
        checkedAt: now,
        checks: assurance.checks,
        resourceId,
        restoreReady: assurance.restoreReady,
        status: assurance.status,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: resourceBackupAssurances.backupOperationId,
        set: {
          checkedAt: now,
          checks: assurance.checks,
          restoreReady: assurance.restoreReady,
          status: assurance.status,
          updatedAt: now,
        },
      });
  }
  if (
    shouldEmitBackupNotRestorableNotification(
      assurance.status,
      previous?.status,
    )
  ) {
    await emitBackupAssuranceNotification({
      backupId: assurance.backupId,
      checkedAt: now,
      resourceId,
    }).catch(() => undefined);
  }
}

export async function assureConfiguredResourceBackups(now = new Date()) {
  const resources = await getTowbarDatabase()
    .select({
      config: apps.config,
      id: apps.id,
      sourceId: apps.sourceId,
      workspaceId: apps.workspaceId,
    })
    .from(apps)
    .where(and(ne(apps.kind, "app"), isNull(apps.archivedAt)));
  let checked = 0;
  for (const resource of resources) {
    if (!isNormalizedResource(resource.config) || !resource.config.backup) {
      continue;
    }
    checked += await assureRetainedResourceBackups(resource.id, now).catch(
      () => 0,
    );
  }
  return checked;
}

export async function assureResourceBackup(
  resourceId: string,
  now = new Date(),
  backupOperationId?: string,
): Promise<BackupAssurance> {
  const [resource] = await getTowbarDatabase()
    .select({
      config: apps.config,
      id: apps.id,
      sourceId: apps.sourceId,
      workspaceId: apps.workspaceId,
    })
    .from(apps)
    .where(eq(apps.id, resourceId))
    .limit(1);
  if (
    !resource ||
    !isNormalizedResource(resource.config) ||
    !resource.config.backup ||
    (resource.config.kind !== "postgres" && resource.config.kind !== "redis")
  ) {
    throw new Error("Backup assurance requires a managed database Resource");
  }
  const [latest] = await getTowbarDatabase()
    .select({
      createdAt: resourceOperations.createdAt,
      id: resourceOperations.id,
      result: resourceOperations.result,
    })
    .from(resourceOperations)
    .where(
      and(
        eq(resourceOperations.resourceId, resource.id),
        eq(resourceOperations.type, "backup"),
        eq(resourceOperations.state, "succeeded"),
        isNull(resourceOperations.deletedAt),
        ...(backupOperationId
          ? [eq(resourceOperations.id, backupOperationId)]
          : []),
      ),
    )
    .orderBy(desc(resourceOperations.createdAt))
    .limit(1);
  const result = latest
    ? backupOperationResultSchema.safeParse(latest.result)
    : null;
  const [latestRetained] = backupOperationId
    ? await getTowbarDatabase()
        .select({ id: resourceOperations.id })
        .from(resourceOperations)
        .where(
          and(
            eq(resourceOperations.resourceId, resource.id),
            eq(resourceOperations.type, "backup"),
            eq(resourceOperations.state, "succeeded"),
            isNull(resourceOperations.deletedAt),
          ),
        )
        .orderBy(desc(resourceOperations.createdAt))
        .limit(1)
    : [{ id: latest?.id }];
  const backupResult = result?.success ? result.data : null;
  const object = latest
    ? await inspectBackupObject({
        result: backupResult,
        sourceId: resource.sourceId,
        workspaceId: resource.workspaceId,
      })
    : null;
  const schedule = resource.config.backup.schedule;
  const occurrence = schedule
    ? getLatestBackupScheduleOccurrence(schedule.cron, now)
    : null;
  const staleAfter =
    latest?.id === latestRetained?.id &&
    occurrence &&
    now.getTime() - occurrence.getTime() >= 2 * 60 * 60_000
      ? occurrence
      : null;
  const assurance = evaluateBackupAssurance({
    backup:
      latest && result?.success
        ? {
            checksum: result.data.checksum,
            createdAt: latest.createdAt,
            encryption: result.data.encryption,
            engine: result.data.engine,
            engineMajorVersion: result.data.engineMajorVersion,
            format: result.data.format,
            id: latest.id,
            metadataVersion: result.data.metadataVersion,
            sizeBytes: result.data.sizeBytes,
          }
        : null,
    checkedAt: now,
    expectedEngine: resource.config.kind,
    object,
    staleAfter,
  });
  await persistBackupAssurance({ assurance, now, resourceId: resource.id });
  return assurance;
}

async function assureRetainedResourceBackups(resourceId: string, now: Date) {
  const backups = await getTowbarDatabase()
    .select({ id: resourceOperations.id })
    .from(resourceOperations)
    .where(
      and(
        eq(resourceOperations.resourceId, resourceId),
        eq(resourceOperations.type, "backup"),
        eq(resourceOperations.state, "succeeded"),
        isNull(resourceOperations.deletedAt),
      ),
    );
  if (backups.length === 0) {
    await assureResourceBackup(resourceId, now);
    return 1;
  }
  for (const backup of backups) {
    await assureResourceBackup(resourceId, now, backup.id);
  }
  return backups.length;
}

function parsePositiveInteger(value: string | undefined) {
  if (!value || !/^\d+$/u.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function classifyS3HeadFailure(
  error: unknown,
): "access_denied" | "unavailable" | undefined {
  if (typeof error !== "object" || error === null) return "unavailable";
  const candidate = error as {
    $metadata?: { httpStatusCode?: number };
    name?: string;
  };
  if (
    candidate.$metadata?.httpStatusCode === 404 ||
    candidate.name === "NoSuchKey" ||
    candidate.name === "NotFound"
  ) {
    return undefined;
  }
  if (
    candidate.$metadata?.httpStatusCode === 403 ||
    candidate.name === "AccessDenied"
  ) {
    return "access_denied";
  }
  return "unavailable";
}
