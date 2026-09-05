import { requireOperationSource } from "./operation-source.js";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  isNormalizedResource,
  restoreOperationResultSchema,
} from "@workspace/towbar-core";

import {
  cleanupRestoreVolumesScript,
  preflightRestoreScript,
  prepareCandidateScript,
  promoteCandidateScript,
  restoreCandidateScript,
} from "./resource-restore-scripts.js";
import type {
  BackupStorage,
  ResourceOperationExecutionContext,
  ResourceOperationHooks,
  ResourceOperationSecrets,
} from "./types.js";
import type {
  BackupOperationResult,
  NormalizedResource,
  RestoreOperationResult,
} from "@workspace/towbar-core";
import type { SshSession } from "./ssh.js";

type ManagedRestoreInput = {
  context: ResourceOperationExecutionContext;
  hooks: ResourceOperationHooks;
  localDirectory: string;
  remoteDirectory: string;
  secrets: ResourceOperationSecrets;
  session: SshSession;
  signal?: AbortSignal;
  storage?: BackupStorage;
};

type RestoreBackupResult = BackupOperationResult & {
  engine: "postgres" | "redis";
  engineMajorVersion: number;
  format: "postgres-custom" | "redis-rdb";
  metadataVersion: 1;
};

type RestorePlan = {
  backup: NonNullable<ResourceOperationExecutionContext["restoreBackup"]>;
  candidateContainer: string;
  candidateVolume: string;
  context: ResourceOperationExecutionContext;
  deployableId: string;
  hooks: ResourceOperationHooks;
  input: ManagedRestoreInput;
  localBackup: string;
  release: NonNullable<ResourceOperationExecutionContext["currentRelease"]>;
  remoteBackup: string;
  resource: NormalizedResource & { kind: "postgres" | "redis" };
  result: RestoreBackupResult;
  runtimeDirectory: string;
  secrets: ResourceOperationSecrets;
  session: SshSession;
  signal?: AbortSignal;
  storage: BackupStorage;
  volume: NormalizedResource["container"]["volumes"][number];
};

export class ManagedRestoreError extends Error {
  constructor(
    message: string,
    readonly restoreResult: RestoreOperationResult,
  ) {
    super(message);
    this.name = "ManagedRestoreError";
  }
}

function resolveRestorePlan(input: ManagedRestoreInput): RestorePlan {
  const { context, hooks, secrets, session, signal, storage } = input;
  const resource = context.deployable;
  const release = context.currentRelease;
  const backup = context.restoreBackup;
  if (
    context.request.type !== "restore" ||
    !resource ||
    !isNormalizedResource(resource) ||
    (resource.kind !== "postgres" && resource.kind !== "redis") ||
    !release ||
    !backup ||
    !storage ||
    !secrets.aws ||
    !context.deployableId
  ) {
    throw new Error("Restore execution context is incomplete");
  }
  if (resource.container.volumes.length !== 1) {
    throw new Error("Managed restore requires exactly one database volume");
  }
  const result = backup.result;
  if (
    result.metadataVersion !== 1 ||
    result.engine !== resource.kind ||
    !result.engineMajorVersion ||
    !result.format
  ) {
    throw new Error("Backup metadata is not restore-ready");
  }
  const expectedFormat =
    resource.kind === "postgres" ? "postgres-custom" : "redis-rdb";
  if (result.format !== expectedFormat) {
    throw new Error("Backup format is incompatible with this Resource");
  }
  const databaseResource = resource as RestorePlan["resource"];
  const volume = databaseResource.container.volumes[0]!;
  const candidateVolume = `towbar-${context.deployableId}-restore-${context.operationId.slice(0, 12)}-${volume.name}`;
  const candidateContainer = `towbar-restore-${context.operationId}`;
  return {
    backup,
    candidateContainer,
    candidateVolume,
    context,
    deployableId: context.deployableId,
    hooks,
    input,
    localBackup: path.join(
      input.localDirectory,
      `restore.${databaseResource.kind}`,
    ),
    release,
    remoteBackup: `${input.remoteDirectory}/backup`,
    resource: databaseResource,
    result: result as RestoreBackupResult,
    runtimeDirectory: `${input.remoteDirectory}/runtime`,
    secrets,
    session,
    signal,
    storage,
    volume,
  };
}

async function verifyRestoreObject(plan: RestorePlan) {
  const { result, storage } = plan;
  const object = await storage.headObject({
    bucket: result.bucket,
    key: result.key,
    ...(result.objectVersionId ? { versionId: result.objectVersionId } : {}),
  });
  const matches =
    object.exists &&
    object.checksum === result.checksum &&
    object.sizeBytes === result.sizeBytes &&
    object.engine === result.engine &&
    object.engineMajorVersion === result.engineMajorVersion &&
    object.format === result.format &&
    object.metadataVersion === 1 &&
    object.encryption === result.encryption;
  if (!matches) {
    throw new Error("Backup object no longer matches its assured metadata");
  }
}

export async function executeManagedRestore(input: ManagedRestoreInput) {
  const plan = resolveRestorePlan(input);
  const {
    backup,
    candidateContainer,
    candidateVolume,
    context,
    deployableId,
    hooks,
    localBackup,
    release,
    remoteBackup,
    resource,
    result,
    runtimeDirectory,
    secrets,
    session,
    signal,
    storage,
    volume,
  } = plan;
  let previousVolume = "";
  let promotionStarted = false;
  await progress(
    hooks,
    "preflight",
    "Checking backup, server, and active runtime",
    {
      command: "docker inspect <active-runtime>",
    },
  );
  await verifyRestoreObject(plan);
  const preflight = await session.run(
    preflightRestoreScript,
    [
      release.containerName,
      deployableId,
      resource.id,
      volume.name,
      String(result.sizeBytes),
      resource.kind,
      String(result.engineMajorVersion),
    ],
    { signal, timeoutMs: 120_000 },
  );
  const [activeVolume] = preflight.stdout.trim().split("\n");
  if (!activeVolume) throw new Error("Active database volume was not found");
  previousVolume = activeVolume;

  try {
    await progress(
      hooks,
      "downloading_backup",
      "Downloading the retained S3 object",
      {
        command: "s3:GetObject <retained-backup>",
      },
    );
    await storage.download({
      bucket: result.bucket,
      key: result.key,
      localPath: localBackup,
      ...(result.objectVersionId ? { versionId: result.objectVersionId } : {}),
    });
    await progress(
      hooks,
      "verifying_backup",
      "Verifying the downloaded checksum and format",
      {
        command: `${resource.kind === "postgres" ? "pg_restore --list" : "redis-check-rdb"} <backup>`,
      },
    );
    const localMetadata = await stat(localBackup);
    if (
      localMetadata.size !== result.sizeBytes ||
      (await sha256File(localBackup)) !== result.checksum
    ) {
      throw new Error("Downloaded backup checksum or size does not match");
    }
    await session.run(
      'install -d -m 700 "$1" "$2"',
      [input.remoteDirectory, runtimeDirectory],
      { signal, timeoutMs: 30_000 },
    );
    await session.upload(localBackup, remoteBackup, {
      signal,
      timeoutMs: 30 * 60_000,
    });
    await uploadRuntimeSecrets({
      localDirectory: input.localDirectory,
      remoteDirectory: runtimeDirectory,
      runtime: secrets.runtime,
      session,
      signal,
    });
    await progress(
      hooks,
      "preparing_candidate",
      "Creating an isolated candidate volume",
      {
        command: "docker volume create <restore-candidate>",
      },
    );
    await session.run(
      prepareCandidateScript,
      [candidateVolume, deployableId, requireOperationSource(context.sourceId)],
      { signal, timeoutMs: 30_000 },
    );
    await progress(
      hooks,
      "restoring_candidate",
      `Restoring ${resource.kind} into the candidate`,
      {
        command:
          resource.kind === "postgres"
            ? "pg_restore <backup>"
            : "redis-check-rdb <backup>",
      },
    );
    await session.run(
      restoreCandidateScript,
      [
        resource.kind,
        candidateContainer,
        candidateVolume,
        volume.mountPath,
        remoteBackup,
        release.imageTag,
        String(resource.container.resources.cpus),
        resource.container.resources.memory,
        runtimeDirectory,
        ...resource.container.command,
      ],
      { signal, timeoutMs: 45 * 60_000 },
    );
    await progress(
      hooks,
      "validating_candidate",
      "Candidate database is readable and healthy",
      {
        command:
          resource.kind === "postgres" ? "psql SELECT 1" : "redis-cli PING",
        level: "success",
      },
    );
    promotionStarted = true;
    await progress(
      hooks,
      "promoting",
      "Promoting the validated candidate atomically",
      {
        command: "towbar restore promote <candidate>",
      },
    );
    const pointer = `/var/lib/towbar/resources/${deployableId}/volumes/${volume.name}.active`;
    const promoted = await session.run(
      promoteCandidateScript,
      [
        resource.kind,
        release.containerName,
        candidateContainer,
        candidateVolume,
        previousVolume,
        pointer,
        volume.mountPath,
        release.imageTag,
        resource.container.network ?? "",
        resource.container.networkAlias ?? "",
        resource.access?.sshTunnel.hostPort
          ? String(resource.access.sshTunnel.hostPort)
          : "",
        resource.container.port ? String(resource.container.port) : "",
        String(resource.container.resources.cpus),
        resource.container.resources.memory,
        runtimeDirectory,
        deployableId,
        resource.id,
        requireOperationSource(context.sourceId),
        release.releaseId,
        "restore",
        ...resource.container.command,
      ],
      // Promotion and rollback are intentionally non-cancellable.
      { timeoutMs: 10 * 60_000 },
    );
    const validation = {
      databaseName:
        resource.kind === "postgres"
          ? (secrets.runtime.POSTGRES_DB ?? "postgres")
          : null,
      engine: resource.kind,
      engineMajorVersion: result.engineMajorVersion,
      healthVerified: true,
      readable: true,
    } as const;
    if (promoted.stdout.includes("ROLLED_BACK")) {
      await progress(
        hooks,
        "rolling_back",
        "Promotion failed; the previous runtime was restored",
        {
          level: "error",
        },
      );
      const rollbackResult = restoreOperationResultSchema.parse({
        activeVolumes: [
          { logicalName: volume.name, volumeName: previousVolume },
        ],
        candidateCleaned: true,
        outcome: "rolled_back",
        previousVolumes: [],
        restoredBackupId: backup.id,
        rollbackAvailableUntil: null,
        validation: null,
        verifiedAt: null,
      });
      throw new ManagedRestoreError(
        "Candidate promotion failed and Towbar restored the previous runtime",
        rollbackResult,
      );
    }
    await progress(
      hooks,
      "verifying_promotion",
      "Promoted database passed its live validation",
      {
        level: "success",
      },
    );
    await progress(
      hooks,
      "retaining_previous",
      "Previous volume retained for seven days",
      {
        level: "success",
      },
    );
    return restoreOperationResultSchema.parse({
      activeVolumes: [
        { logicalName: volume.name, volumeName: candidateVolume },
      ],
      candidateCleaned: false,
      outcome: "promoted",
      previousVolumes: [
        { logicalName: volume.name, volumeName: previousVolume },
      ],
      restoredBackupId: backup.id,
      rollbackAvailableUntil: new Date(
        Date.now() + 7 * 24 * 60 * 60_000,
      ).toISOString(),
      validation,
      verifiedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (!promotionStarted) {
      await session
        .run(
          'docker rm -f "$1" >/dev/null 2>&1 || true; docker volume rm "$2" >/dev/null 2>&1 || true',
          [candidateContainer, candidateVolume],
          { timeoutMs: 120_000 },
        )
        .catch(() => undefined);
    }
    if (
      error instanceof ManagedRestoreError ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      throw error;
    }
    const failureResult = restoreOperationResultSchema.parse({
      activeVolumes: [{ logicalName: volume.name, volumeName: previousVolume }],
      candidateCleaned: !promotionStarted,
      outcome: promotionStarted ? "rollback_failed" : "candidate_failed",
      previousVolumes: [],
      restoredBackupId: backup.id,
      rollbackAvailableUntil: null,
      validation: null,
      verifiedAt: null,
    });
    throw new ManagedRestoreError(
      promotionStarted
        ? "Candidate promotion and automatic rollback failed; operator intervention is required"
        : error instanceof Error
          ? error.message
          : "Candidate restore failed",
      failureResult,
    );
  }
}

export async function executeRestoreCleanup(input: {
  context: ResourceOperationExecutionContext;
  session: SshSession;
  signal?: AbortSignal;
}) {
  if (
    input.context.request.type !== "restore_cleanup" ||
    !input.context.deployableId
  ) {
    throw new Error("Restore cleanup context is incomplete");
  }
  const { stdout } = await input.session.run(
    cleanupRestoreVolumesScript,
    [input.context.deployableId, ...input.context.request.volumes],
    { signal: input.signal, timeoutMs: 5 * 60_000 },
  );
  const result = JSON.parse(stdout) as { cleaned: string[]; skipped: string[] };
  return {
    cleanedVolumes: result.cleaned,
    restoreId: input.context.request.restoreId,
    skippedVolumes: result.skipped,
  };
}

async function uploadRuntimeSecrets(input: {
  localDirectory: string;
  remoteDirectory: string;
  runtime: Record<string, string>;
  session: SshSession;
  signal?: AbortSignal;
}) {
  const localSecrets = path.join(input.localDirectory, "restore-runtime");
  await mkdir(localSecrets, { mode: 0o700, recursive: true });
  for (const [key, value] of Object.entries(input.runtime)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key) || value.includes("\0")) {
      throw new Error("Runtime secret bundle contains an invalid value");
    }
    const localPath = path.join(localSecrets, key);
    await writeFile(localPath, value, { encoding: "utf8", mode: 0o600 });
    await input.session.upload(localPath, `${input.remoteDirectory}/${key}`, {
      signal: input.signal,
      timeoutMs: 30_000,
    });
  }
}

async function progress(
  hooks: ResourceOperationHooks,
  phase: Parameters<
    NonNullable<ResourceOperationHooks["progress"]>
  >[0]["phase"],
  message: string,
  extra: {
    command?: string;
    level?: "error" | "info" | "success";
  } = {},
) {
  await hooks.progress?.({ ...extra, message, phase });
}

async function sha256File(filePath: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

export const restoreScripts = {
  cleanup: cleanupRestoreVolumesScript,
  preflight: preflightRestoreScript,
  prepareCandidate: prepareCandidateScript,
  promote: promoteCandidateScript,
  restoreCandidate: restoreCandidateScript,
} as const;
