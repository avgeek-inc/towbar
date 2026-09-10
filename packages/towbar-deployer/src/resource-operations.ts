import { requireOperationSource } from "./operation-source.js";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  isNormalizedResource,
  maximumBackupBytes,
  orphanItemSchema,
} from "@workspace/towbar-core";

import { redactSensitiveValues } from "./secrets.js";
import { SshSession } from "./ssh.js";

import type {
  BackupStorage,
  ResourceOperationExecutionContext,
  ResourceOperationExecutorResult,
  ResourceOperationHooks,
  ResourceOperationSecrets,
} from "./types.js";
import type {
  BackupDestinationResult,
  BackupProvider,
  NormalizedResource,
  OrphanItem,
} from "@workspace/towbar-core";
import {
  executeManagedRestore,
  executeRestoreCleanup,
} from "./resource-restore.js";

const createBackupScript = String.raw`
set -euo pipefail
kind="$1"
container="$2"
remote_dir="$3"
backup_path="$4"
deployable_id="$5"
install -d -m 700 "$remote_dir"
test "$(docker inspect --format '{{index .Config.Labels "towbar.managed"}}' "$container")" = true
owned="$(docker inspect --format '{{index .Config.Labels "towbar.deployable"}}' "$container")"
test "$owned" = "$deployable_id"
if test "$kind" = postgres; then
  docker exec "$container" sh -c 'exec pg_dump -U "${"$"}{POSTGRES_USER:-postgres}" -d "${"$"}{POSTGRES_DB:-postgres}" --format=custom --no-owner --no-privileges' >"$backup_path"
  test -s "$backup_path"
  docker cp "$backup_path" "$container:/tmp/towbar-backup.dump"
  docker exec "$container" pg_restore --list /tmp/towbar-backup.dump >/dev/null
  docker exec "$container" rm -f /tmp/towbar-backup.dump
  docker exec "$container" postgres --version | sed -E 's/.* ([0-9]+)(\..*)?$/\1/'
elif test "$kind" = redis; then
  docker exec "$container" sh -c 'rm -f /tmp/towbar-backup.rdb; redis-cli -a "$REDIS_PASSWORD" --no-auth-warning --rdb /tmp/towbar-backup.rdb >/dev/null; test -s /tmp/towbar-backup.rdb'
  docker exec "$container" redis-check-rdb /tmp/towbar-backup.rdb >/dev/null
  docker cp "$container:/tmp/towbar-backup.rdb" "$backup_path"
  docker exec "$container" rm -f /tmp/towbar-backup.rdb
  docker exec "$container" redis-server --version | sed -E 's/.*v=([0-9]+)(\..*)?.*/\1/'
else
  exit 64
fi
chmod 600 "$backup_path"
test "$(stat -c %s "$backup_path")" -le ${maximumBackupBytes}
`;

const containerOperationScript = String.raw`
set -euo pipefail
operation="$1"
container="$2"
deployable_id="$3"
tail_lines="$4"
managed="$(docker inspect --format '{{index .Config.Labels "towbar.managed"}}' "$container")"
owned="$(docker inspect --format '{{index .Config.Labels "towbar.deployable"}}' "$container")"
test "$managed" = true
test "$owned" = "$deployable_id"
case "$operation" in
  capture_logs) docker logs --timestamps --tail "$tail_lines" "$container" 2>&1 ;;
  restart) docker restart --time 30 "$container" >/dev/null ;;
  start) docker start "$container" >/dev/null ;;
  stop) docker stop --time 30 "$container" >/dev/null ;;
  *) exit 64 ;;
esac
`;

const cleanupOrphansScript = String.raw`
set -euo pipefail
items_json="$1"
expected_json="$2"
python3 - "$items_json" "$expected_json" <<'PYTHON'
import json
import subprocess
import sys

items = json.loads(sys.argv[1])
expected = json.loads(sys.argv[2])
owned_deployables = set(expected.get("ownedDeployableIds", []))
cleaned = []
skipped = []

def command(*args):
    return subprocess.run(args, check=False, capture_output=True, text=True)

def inspect(kind, name):
    result = command("docker", kind, "inspect", name)
    if result.returncode != 0:
        return None
    values = json.loads(result.stdout)
    return values[0] if values else None

for item in items:
    kind = item["kind"]
    name = item["name"]
    value = inspect(kind, name)
    if not value:
        skipped.append(item)
        continue
    labels = ((value.get("Config") or {}).get("Labels") or {}) if kind != "volume" else (value.get("Labels") or {})
    if labels.get("towbar.managed") != "true" or (not labels.get("towbar.source") or labels.get("towbar.deployable") not in owned_deployables):
        skipped.append(item)
        continue
    if kind == "container" and name in expected["containerNames"]:
        skipped.append(item)
        continue
    if kind == "image" and name in expected["imageTags"]:
        skipped.append(item)
        continue
    if kind == "volume" and labels.get("towbar.deployable") in expected["deployableIds"]:
        skipped.append(item)
        continue
    removal = {
        "container": ("docker", "rm", "-f", name),
        "image": ("docker", "image", "rm", name),
        "volume": ("docker", "volume", "rm", name),
    }[kind]
    result = command(*removal)
    if result.returncode == 0:
        cleaned.append(item)
    else:
        skipped.append(item)

print(json.dumps({"cleaned": cleaned, "skipped": skipped}, separators=(",", ":")))
PYTHON
`;

export async function executeResourceOperation(input: {
  context: ResourceOperationExecutionContext;
  hooks?: ResourceOperationHooks;
  secrets: ResourceOperationSecrets;
  storage?: BackupStorage;
  storages?: Partial<Record<BackupProvider, BackupStorage>>;
  signal?: AbortSignal;
}): Promise<ResourceOperationExecutorResult> {
  const { context, secrets, signal } = input;
  const session = await SshSession.connect({
    login: secrets.login,
    server: context.server,
    trustedHostKeys: context.trustedHostKeys,
  });
  const localDirectory = await mkdtemp(
    path.join(tmpdir(), "towbar-resource-operation-"),
  );
  const remoteDirectory = `/tmp/towbar-operation-${context.operationId}`;
  try {
    if (context.request.type === "cleanup_orphans") {
      const { stdout } = await session.run(
        cleanupOrphansScript,
        [
          JSON.stringify(context.request.items),
          JSON.stringify(context.cleanupExpected),
        ],
        { signal, timeoutMs: 5 * 60_000 },
      );
      const result = JSON.parse(stdout) as {
        cleaned: OrphanItem[];
        skipped: OrphanItem[];
      };
      return {
        cleaned: result.cleaned.map((item) => orphanItemSchema.parse(item)),
        skipped: result.skipped.map((item) => orphanItemSchema.parse(item)),
      };
    }

    if (context.request.type === "restore") {
      return await executeManagedRestore({
        ...input,
        hooks: input.hooks ?? {},
        localDirectory,
        remoteDirectory,
        session,
      });
    }
    if (context.request.type === "restore_cleanup") {
      return await executeRestoreCleanup({
        context,
        session,
        signal,
      });
    }

    const deployable = context.deployable;
    const release = context.currentRelease;
    if (!deployable || !context.deployableId || !release) {
      throw new Error("A current release is required for this operation");
    }
    if (context.request.type === "backup") {
      if (!isNormalizedResource(deployable)) {
        throw new Error("Managed backups require a database Resource");
      }
      return await createBackup({
        ...input,
        deployable,
        localDirectory,
        remoteDirectory,
        session,
      });
    }
    const { stdout } = await session.run(
      containerOperationScript,
      [
        context.request.type,
        release.containerName,
        context.deployableId,
        context.request.type === "capture_logs"
          ? String(context.request.tail)
          : "0",
      ],
      { signal, timeoutMs: 2 * 60_000 },
    );
    if (context.request.type === "capture_logs") {
      const redacted = redactSensitiveValues(stdout, secrets.sensitiveValues);
      const limit = 256 * 1_024;
      return {
        logs: redacted.slice(-limit),
        truncated: redacted.length > limit,
      };
    }
    return {
      state: context.request.type === "stop" ? "stopped" : "running",
    };
  } finally {
    await session
      .run('rm -rf "$1"', [remoteDirectory], { timeoutMs: 30_000 })
      .catch(() => undefined);
    await session.close().catch(() => undefined);
    await rm(localDirectory, { force: true, recursive: true });
  }
}

async function createBackup(input: {
  context: ResourceOperationExecutionContext;
  deployable: NormalizedResource;
  localDirectory: string;
  remoteDirectory: string;
  secrets: ResourceOperationSecrets;
  session: SshSession;
  signal?: AbortSignal;
  storage?: BackupStorage;
  storages?: Partial<Record<BackupProvider, BackupStorage>>;
}) {
  const backup = input.deployable.backup;
  const release = input.context.currentRelease;
  if (!backup || !release) {
    throw new Error("A current release is required for this operation");
  }
  if (
    input.deployable.kind !== "postgres" &&
    input.deployable.kind !== "redis"
  ) {
    throw new Error("Managed backups require a PostgreSQL or Redis resource");
  }
  const engine: "postgres" | "redis" = input.deployable.kind;

  const { availableStorages, configuredProviders } = resolveBackupStorages(
    backup,
    input.storages,
    input.storage,
  );

  const extension = input.deployable.kind === "postgres" ? "dump" : "rdb";
  const localPath = path.join(input.localDirectory, `backup.${extension}`);
  const remotePath = `${input.remoteDirectory}/backup.${extension}`;
  const { stdout } = await input.session.run(
    createBackupScript,
    [
      input.deployable.kind,
      release.containerName,
      input.remoteDirectory,
      remotePath,
      input.context.deployableId!,
    ],
    { signal: input.signal, timeoutMs: 30 * 60_000 },
  );
  const engineMajorVersion = Number(stdout.trim().split(/\s+/u).at(-1));
  if (!Number.isSafeInteger(engineMajorVersion) || engineMajorVersion <= 0) {
    throw new Error("Backup engine major version could not be determined");
  }
  await input.session.download(remotePath, localPath, {
    signal: input.signal,
    timeoutMs: 30 * 60_000,
  });
  const createdAt = new Date();
  const timestamp = createdAt.toISOString().replaceAll(":", "-");
  const sourceId = requireOperationSource(input.context.sourceId);
  const checksum = await sha256File(localPath);
  const metadata = await stat(localPath);
  if (metadata.size > maximumBackupBytes) {
    throw new Error("Backup exceeds Towbar's 20 GiB safety limit");
  }
  const format =
    input.deployable.kind === "postgres" ? "postgres-custom" : "redis-rdb";

  const destinationResults: BackupDestinationResult[] = [];

  for (const provider of configuredProviders) {
    const storage = availableStorages[provider]!;
    const config = getDestinationUploadParams(
      provider,
      backup,
      sourceId,
      input.context.operationId,
      timestamp,
      extension,
      input.secrets.aws?.region,
    );
    const result = await uploadAndVerifyDestination({
      checksum,
      config,
      engine,
      engineMajorVersion,
      expectedS3Encryption: backup.s3?.encryption,
      format,
      localPath,
      provider,
      sizeBytes: metadata.size,
      storage,
    });
    destinationResults.push(result);
  }

  const { deletedBackupIds, warnings } = await cleanupRetentionBackups(
    input.context.retentionBackups,
    configuredProviders,
    availableStorages,
  );

  return buildBackupResult({
    backup,
    checksum,
    deletedBackupIds,
    destinationResults,
    engine,
    engineMajorVersion,
    format,
    operationId: input.context.operationId,
    region: input.secrets.aws?.region,
    sizeBytes: metadata.size,
    warnings,
  });
}

function resolveBackupStorages(
  backup: NonNullable<NormalizedResource["backup"]>,
  storages?: Partial<Record<BackupProvider, BackupStorage>>,
  singleStorage?: BackupStorage,
) {
  const availableStorages: Partial<Record<BackupProvider, BackupStorage>> = {
    ...storages,
    ...(singleStorage ? { [backup.restoreFrom]: singleStorage } : {}),
  };

  const configuredProviders: BackupProvider[] = [];
  if (backup.s3) configuredProviders.push("s3");
  if (backup.gcs) configuredProviders.push("gcs");
  if (backup.azureBlob) configuredProviders.push("azureBlob");

  if (configuredProviders.length === 0) {
    throw new Error(
      "Backup storage configuration is incomplete: no destination configured",
    );
  }

  for (const provider of configuredProviders) {
    if (!availableStorages[provider]) {
      throw new Error(
        `Backup storage configuration is incomplete: missing storage for ${provider}`,
      );
    }
  }

  return { availableStorages, configuredProviders };
}

function getDestinationUploadParams(
  provider: BackupProvider,
  backup: NonNullable<NormalizedResource["backup"]>,
  sourceId: string,
  operationId: string,
  timestamp: string,
  extension: string,
  defaultAwsRegion?: string,
) {
  const fileKey = `${timestamp}.${extension}`;
  if (provider === "s3") {
    const s3Prefix = backup.s3?.prefix || "towbar";
    return {
      bucket: backup.s3?.bucket ?? "",
      encryption: backup.s3?.encryption ?? "AES256",
      key: [s3Prefix, sourceId, operationId, fileKey].filter(Boolean).join("/"),
      kmsKeyId: backup.s3?.kmsKeyId,
      region: backup.s3?.region ?? defaultAwsRegion,
      storageAccount: undefined,
    };
  }
  if (provider === "gcs") {
    const gcsPrefix = backup.gcs?.prefix || "towbar";
    return {
      bucket: backup.gcs?.bucket ?? "",
      encryption: "Google-managed",
      key: [gcsPrefix, sourceId, operationId, fileKey]
        .filter(Boolean)
        .join("/"),
      kmsKeyId: undefined,
      region: backup.gcs?.region,
      storageAccount: undefined,
    };
  }
  const azurePrefix = backup.azureBlob?.prefix || "towbar";
  return {
    bucket: backup.azureBlob?.container ?? "",
    encryption: "Microsoft-managed",
    key: [azurePrefix, sourceId, operationId, fileKey]
      .filter(Boolean)
      .join("/"),
    kmsKeyId: undefined,
    region: undefined,
    storageAccount: backup.azureBlob?.storageAccount,
  };
}

async function uploadAndVerifyDestination(params: {
  checksum: string;
  config: ReturnType<typeof getDestinationUploadParams>;
  engine: "postgres" | "redis";
  engineMajorVersion: number;
  expectedS3Encryption?: string;
  format: "postgres-custom" | "redis-rdb";
  localPath: string;
  provider: BackupProvider;
  sizeBytes: number;
  storage: BackupStorage;
}): Promise<BackupDestinationResult> {
  const { config, storage } = params;
  const upload = await storage.upload({
    bucket: config.bucket,
    encryption: config.encryption,
    key: config.key,
    ...(config.kmsKeyId ? { kmsKeyId: config.kmsKeyId } : {}),
    localPath: params.localPath,
    metadata: {
      "towbar-checksum": params.checksum,
      "towbar-engine": params.engine,
      "towbar-engine-major-version": String(params.engineMajorVersion),
      "towbar-format": params.format,
      "towbar-metadata-version": "1",
    },
    sizeBytes: params.sizeBytes,
    ...(config.storageAccount ? { storageAccount: config.storageAccount } : {}),
  });

  const verified = await storage.headObject({
    bucket: config.bucket,
    key: config.key,
    ...(upload.versionId ? { versionId: upload.versionId } : {}),
    ...(config.storageAccount ? { storageAccount: config.storageAccount } : {}),
  });

  if (
    !verified.exists ||
    !verified.encryption ||
    verified.checksum !== params.checksum ||
    verified.sizeBytes !== params.sizeBytes ||
    verified.engine !== params.engine ||
    verified.engineMajorVersion !== params.engineMajorVersion ||
    verified.format !== params.format ||
    verified.metadataVersion !== 1 ||
    (params.provider === "s3" &&
      verified.encryption !== params.expectedS3Encryption)
  ) {
    throw new Error(
      `Uploaded backup to ${params.provider} failed restore-readiness verification`,
    );
  }

  return {
    bucket: config.bucket,
    encryption: verified.encryption,
    key: config.key,
    ...(upload.versionId ? { objectVersion: upload.versionId } : {}),
    provider: params.provider,
    ...(config.region ? { region: config.region } : {}),
    ...(config.storageAccount ? { storageAccount: config.storageAccount } : {}),
  };
}

async function cleanupRetentionBackups(
  retentionBackups: readonly {
    bucket: string;
    destinations?: readonly BackupDestinationResult[];
    id: string;
    key: string;
    storageAccount?: string;
  }[],
  configuredProviders: readonly BackupProvider[],
  availableStorages: Partial<Record<BackupProvider, BackupStorage>>,
) {
  const deletedBackupIds: string[] = [];
  const warnings: string[] = [];
  for (const candidate of retentionBackups) {
    let anySucceeded = false;
    let deleteFailed = false;
    const destinations =
      candidate.destinations && candidate.destinations.length > 0
        ? candidate.destinations
        : configuredProviders.map((provider) => ({
            bucket: candidate.bucket,
            key: candidate.key,
            provider,
            storageAccount: candidate.storageAccount,
          }));

    for (const dest of destinations) {
      const storage = availableStorages[dest.provider];
      if (!storage) {
        deleteFailed = true;
        continue;
      }
      try {
        await storage.deleteObject({
          bucket: dest.bucket,
          key: dest.key,
          ...(dest.storageAccount
            ? { storageAccount: dest.storageAccount }
            : {}),
        });
        anySucceeded = true;
      } catch {
        deleteFailed = true;
      }
    }

    if (anySucceeded && !deleteFailed) {
      deletedBackupIds.push(candidate.id);
    } else {
      warnings.push(
        `Retention cleanup could not delete backup ${candidate.id} from every destination; it will be retried`,
      );
    }
  }
  return { deletedBackupIds, warnings };
}

function buildBackupResult(params: {
  backup: NonNullable<NormalizedResource["backup"]>;
  checksum: string;
  deletedBackupIds: string[];
  destinationResults: BackupDestinationResult[];
  engine: "postgres" | "redis";
  engineMajorVersion: number;
  format: "postgres-custom" | "redis-rdb";
  operationId: string;
  region?: string;
  sizeBytes: number;
  warnings: string[];
}): ResourceOperationExecutorResult {
  const { backup, destinationResults } = params;
  const primaryDest =
    destinationResults.find((dest) => dest.provider === backup.restoreFrom) ??
    destinationResults[0]!;
  const region = primaryDest.region ?? params.region;

  return {
    backupId: params.operationId,
    bucket: primaryDest.bucket,
    checksum: params.checksum,
    deletedBackupIds: params.deletedBackupIds,
    destinations: destinationResults,
    encryption:
      primaryDest.encryption ??
      ((backup.s3?.encryption ?? "AES256") as "AES256" | "aws:kms"),
    engine: params.engine,
    engineMajorVersion: params.engineMajorVersion,
    format: params.format,
    key: primaryDest.key,
    metadataVersion: 1,
    ...(primaryDest.objectVersion
      ? { objectVersionId: primaryDest.objectVersion }
      : {}),
    ...(region ? { region } : {}),
    restoreFrom: backup.restoreFrom,
    sizeBytes: params.sizeBytes,
    ...(primaryDest.storageAccount
      ? { storageAccount: primaryDest.storageAccount }
      : {}),
    verifiedAt: new Date().toISOString(),
    warnings: params.warnings,
  };
}

async function sha256File(filePath: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

export const resourceOperationScripts = {
  cleanupOrphans: cleanupOrphansScript,
  containerOperation: containerOperationScript,
  createBackup: createBackupScript,
} as const;

export const resourceOperationInternal = {
  buildBackupResult,
  cleanupRetentionBackups,
  uploadAndVerifyDestination,
} as const;
