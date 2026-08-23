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
  ResourceOperationSecrets,
} from "./types.js";
import type { NormalizedResource, OrphanItem } from "@workspace/towbar-core";

const createBackupScript = String.raw`
set -euo pipefail
kind="$1"
container="$2"
remote_dir="$3"
backup_path="$4"
deployable_id="$5"
manifest_id="$6"
install -d -m 700 "$remote_dir"
test "$(docker inspect --format '{{index .Config.Labels "towbar.managed"}}' "$container")" = true
owned="$(docker inspect --format '{{index .Config.Labels "towbar.deployable"}}' "$container")"
legacy="$(docker inspect --format '{{index .Config.Labels "towbar.app"}}' "$container")"
test "$owned" = "$deployable_id" || test "$legacy" = "$manifest_id"
if test "$kind" = postgres; then
  docker exec "$container" sh -c 'exec pg_dump -U "${"$"}{POSTGRES_USER:-postgres}" -d "${"$"}{POSTGRES_DB:-postgres}" --format=custom --no-owner --no-privileges' >"$backup_path"
  test -s "$backup_path"
  docker cp "$backup_path" "$container:/tmp/towbar-backup.dump"
  docker exec "$container" pg_restore --list /tmp/towbar-backup.dump >/dev/null
  docker exec "$container" rm -f /tmp/towbar-backup.dump
elif test "$kind" = redis; then
  docker exec "$container" sh -c 'rm -f /tmp/towbar-backup.rdb; redis-cli -a "$REDIS_PASSWORD" --no-auth-warning --rdb /tmp/towbar-backup.rdb >/dev/null; test -s /tmp/towbar-backup.rdb'
  docker exec "$container" redis-check-rdb /tmp/towbar-backup.rdb >/dev/null
  docker cp "$container:/tmp/towbar-backup.rdb" "$backup_path"
  docker exec "$container" rm -f /tmp/towbar-backup.rdb
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
manifest_id="$4"
tail_lines="$5"
managed="$(docker inspect --format '{{index .Config.Labels "towbar.managed"}}' "$container")"
owned="$(docker inspect --format '{{index .Config.Labels "towbar.deployable"}}' "$container")"
legacy="$(docker inspect --format '{{index .Config.Labels "towbar.app"}}' "$container")"
test "$managed" = true
test "$owned" = "$deployable_id" || test "$legacy" = "$manifest_id"
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
source_id="$1"
items_json="$2"
expected_json="$3"
python3 - "$source_id" "$items_json" "$expected_json" <<'PYTHON'
import json
import subprocess
import sys

source_id = sys.argv[1]
items = json.loads(sys.argv[2])
expected = json.loads(sys.argv[3])
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
    if labels.get("towbar.managed") != "true" or labels.get("towbar.source") != source_id:
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
  secrets: ResourceOperationSecrets;
  storage?: BackupStorage;
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
          context.sourceId,
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
        deployable.id,
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
}) {
  const backup = input.deployable.backup;
  const release = input.context.currentRelease;
  if (!backup || !release || !input.storage || !input.secrets.aws) {
    throw new Error("Backup storage configuration is incomplete");
  }
  const extension = input.deployable.kind === "postgres" ? "dump" : "rdb";
  const localPath = path.join(input.localDirectory, `backup.${extension}`);
  const remotePath = `${input.remoteDirectory}/backup.${extension}`;
  await input.session.run(
    createBackupScript,
    [
      input.deployable.kind,
      release.containerName,
      input.remoteDirectory,
      remotePath,
      input.context.deployableId!,
      input.deployable.id,
    ],
    { signal: input.signal, timeoutMs: 30 * 60_000 },
  );
  await input.session.download(remotePath, localPath, {
    signal: input.signal,
    timeoutMs: 30 * 60_000,
  });
  const createdAt = new Date();
  const key = [
    backup.s3.prefix,
    input.context.sourceId,
    input.context.operationId,
    `${createdAt.toISOString().replaceAll(":", "-")}.${extension}`,
  ]
    .filter(Boolean)
    .join("/");
  const checksum = await sha256File(localPath);
  const metadata = await stat(localPath);
  if (metadata.size > maximumBackupBytes) {
    throw new Error("Backup exceeds Towbar's 20 GiB safety limit");
  }
  await input.storage.upload({
    bucket: backup.s3.bucket,
    encryption: backup.s3.encryption,
    key,
    ...(backup.s3.kmsKeyId ? { kmsKeyId: backup.s3.kmsKeyId } : {}),
    localPath,
    sizeBytes: metadata.size,
  });
  const deletedBackupIds: string[] = [];
  const warnings: string[] = [];
  for (const candidate of input.context.retentionBackups) {
    try {
      await input.storage.deleteObject(candidate);
      deletedBackupIds.push(candidate.id);
    } catch {
      warnings.push(
        `Retention cleanup could not delete backup ${candidate.id}`,
      );
    }
  }
  return {
    backupId: input.context.operationId,
    bucket: backup.s3.bucket,
    checksum,
    deletedBackupIds,
    encryption: backup.s3.encryption,
    key,
    region: backup.s3.region ?? input.secrets.aws.region,
    sizeBytes: metadata.size,
    verifiedAt: new Date().toISOString(),
    warnings,
  } satisfies ResourceOperationExecutorResult;
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
