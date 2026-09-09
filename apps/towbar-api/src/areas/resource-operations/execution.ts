import { resolveServerCredentials } from "../secrets/store.js";
import type { SecretDatabase } from "../secrets/store.js";
import { and, eq, isNull } from "drizzle-orm";

import { backupOperationResultSchema } from "@workspace/towbar-core";
import {
  resourceOperations,
  sshHostKeys,
} from "@workspace/towbar-database/schema";

import { conflict, notFound } from "../../http/errors.js";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import { getDecryptedAwsCredential } from "../aws/service.js";
import { getDecryptedAzureCredential } from "../azure/service.js";
import { getDecryptedGcpCredential } from "../gcp/service.js";
import {
  requireResourcePasswords,
  resolveRuntimeEnvironmentSecrets,
} from "../deployments/deployment-secrets.js";
import { sshLoginSecretSchema } from "../servers/service.js";
import { getCleanupExpected, getRetentionBackups } from "./queries.js";

export async function getOperationExecutionContext(operationId: string) {
  const [operation] = await getTowbarDatabase()
    .select()
    .from(resourceOperations)
    .where(eq(resourceOperations.id, operationId))
    .limit(1);
  if (!operation) throw notFound("Resource operation");
  if (operation.state === "queued") {
    await getTowbarDatabase()
      .update(resourceOperations)
      .set({ startedAt: new Date(), state: "running", updatedAt: new Date() })
      .where(
        and(
          eq(resourceOperations.id, operationId),
          eq(resourceOperations.state, "queued"),
        ),
      );
  } else if (operation.state !== "running") {
    throw conflict("Resource operation is already complete");
  }
  const trustedHostKeys = await getTowbarDatabase()
    .select({
      algorithm: sshHostKeys.algorithm,
      fingerprint: sshHostKeys.fingerprint,
      publicKey: sshHostKeys.publicKey,
    })
    .from(sshHostKeys)
    .where(
      and(
        eq(sshHostKeys.serverId, operation.serverId),
        isNull(sshHostKeys.revokedAt),
      ),
    );
  const currentRelease =
    operation.request.type === "cleanup_orphans"
      ? null
      : operation.request.release;
  const sourceId =
    operation.request.type === "cleanup_orphans"
      ? null
      : requireOperationSource(operation.sourceId);
  const cleanupExpected = await getCleanupExpected(operation.serverId);
  const restoreBackup =
    operation.request.type === "restore" && operation.resourceId
      ? await getRestoreBackup({
          backupId: operation.request.backupId,
          resourceId: operation.resourceId,
          sourceId: sourceId!,
          workspaceId: operation.workspaceId,
        })
      : null;
  return {
    cleanupExpected,
    currentRelease,
    deployable: operation.appSnapshot,
    deployableId: operation.resourceId,
    operationId: operation.id,
    request: operation.request,
    retentionBackups:
      operation.request.type === "backup" && operation.resourceId
        ? await getRetentionBackups(operation.resourceId, operation.appSnapshot)
        : [],
    restoreBackup,
    server: operation.serverSnapshot,
    sourceId,
    trustedHostKeys,
  };
}

export async function resolveOperationSecrets(operationId: string) {
  return await getTowbarDatabase().transaction(
    async (database) => {
      const [operation] = await database
        .select({
          app: resourceOperations.appSnapshot,
          request: resourceOperations.request,
          resourceId: resourceOperations.resourceId,
          server: resourceOperations.serverSnapshot,
          serverId: resourceOperations.serverId,
          sourceId: resourceOperations.sourceId,
          workspaceId: resourceOperations.workspaceId,
        })
        .from(resourceOperations)
        .where(eq(resourceOperations.id, operationId))
        .limit(1);
      if (!operation) throw notFound("Resource operation");
      const credentials = await resolveServerCredentials(operation, database);
      const login = sshLoginSecretSchema.parse({
        privateKey: credentials.values.privateKey,
      });
      const runtime =
        ["capture_logs", "restore"].includes(operation.request.type) &&
        operation.app &&
        operation.resourceId
          ? await resolveRuntimeEnvironmentSecrets(
              {
                appId: operation.resourceId,
                sourceId: requireOperationSource(operation.sourceId),
                workspaceId: operation.workspaceId,
              },
              database,
            )
          : {};
      if (operation.request.type === "restore")
        requireResourcePasswords(operation.app?.kind, runtime);

      const { aws, azure, gcp, sensitiveStorageValues } =
        await resolveCloudStorageSecrets(operation, database);

      return {
        aws,
        azure,
        gcp,
        login,
        runtime,
        sensitiveValues: [
          login.privateKey,
          ...sensitiveStorageValues,
          ...Object.values(runtime),
        ],
      };
    },
    { isolationLevel: "repeatable read" },
  );
}

function extractBackupConfig(
  app: unknown,
): import("@workspace/towbar-core").NormalizedResource["backup"] | undefined {
  if (app && typeof app === "object" && "backup" in app) {
    return (
      app as {
        backup?: import("@workspace/towbar-core").NormalizedResource["backup"];
      }
    ).backup;
  }
  return undefined;
}

async function resolveTargetRestoreProvider(
  operation: {
    request: { type: string; backupId?: string };
  },
  database?: SecretDatabase,
): Promise<"s3" | "gcs" | "azureBlob" | undefined> {
  if (operation.request.type !== "restore" || !operation.request.backupId) {
    return undefined;
  }
  const db = database ?? getTowbarDatabase();
  const [targetBackup] = await db
    .select({ result: resourceOperations.result })
    .from(resourceOperations)
    .where(eq(resourceOperations.id, operation.request.backupId))
    .limit(1);
  if (!targetBackup?.result) {
    return undefined;
  }
  const parsed = backupOperationResultSchema.safeParse(targetBackup.result);
  if (!parsed.success) {
    return undefined;
  }
  return (
    parsed.data.restoreFrom ?? (parsed.data.storageAccount ? "azureBlob" : "s3")
  );
}

function determineRequiredProviders(
  requiresBackup: boolean,
  backupConfig:
    import("@workspace/towbar-core").NormalizedResource["backup"] | undefined,
  restoreFromProvider?: "s3" | "gcs" | "azureBlob",
) {
  if (!requiresBackup) {
    return { needsAws: false, needsAzure: false, needsGcp: false };
  }
  return {
    needsAws:
      !backupConfig ||
      Boolean(backupConfig.s3) ||
      backupConfig.restoreFrom === "s3" ||
      restoreFromProvider === "s3",
    needsAzure: Boolean(
      backupConfig?.azureBlob ||
      backupConfig?.restoreFrom === "azureBlob" ||
      restoreFromProvider === "azureBlob",
    ),
    needsGcp: Boolean(
      backupConfig?.gcs ||
      backupConfig?.restoreFrom === "gcs" ||
      restoreFromProvider === "gcs",
    ),
  };
}

async function resolveCloudStorageSecrets(
  operation: {
    app: unknown;
    request: { type: string; backupId?: string };
    workspaceId: string;
  },
  database?: SecretDatabase,
) {
  const requiresBackup = ["backup", "restore"].includes(operation.request.type);
  const backupConfig = extractBackupConfig(operation.app);
  const restoreFromProvider = await resolveTargetRestoreProvider(
    operation,
    database,
  );
  const { needsAws, needsAzure, needsGcp } = determineRequiredProviders(
    requiresBackup,
    backupConfig,
    restoreFromProvider,
  );

  const [awsCredential, azureCredential, gcpCredential] = await Promise.all([
    needsAws
      ? getDecryptedAwsCredential({
          workspaceId: operation.workspaceId,
        }).catch(() => null)
      : null,
    needsAzure
      ? getDecryptedAzureCredential({
          workspaceId: operation.workspaceId,
        }).catch(() => null)
      : null,
    needsGcp
      ? getDecryptedGcpCredential({
          workspaceId: operation.workspaceId,
        }).catch(() => null)
      : null,
  ]);

  const aws = awsCredential
    ? { ...awsCredential.payload, region: awsCredential.region }
    : null;

  const azure = azureCredential
    ? {
        clientId: azureCredential.clientId,
        clientSecret: azureCredential.payload.clientSecret,
        tenantId: azureCredential.tenantId,
      }
    : null;

  const gcp = gcpCredential
    ? {
        projectId: gcpCredential.projectId,
        serviceAccountKey: JSON.stringify(gcpCredential.payload),
      }
    : null;

  const sensitiveStorageValues = [
    ...(awsCredential ? [awsCredential.payload.secretAccessKey] : []),
    ...(azureCredential ? [azureCredential.payload.clientSecret] : []),
    ...(gcpCredential ? [gcpCredential.payload.private_key] : []),
  ];

  return { aws, azure, gcp, sensitiveStorageValues };
}

function requireOperationSource(sourceId: string | null) {
  if (!sourceId) {
    throw conflict(
      "This Resource operation has no Source context",
      "RESOURCE_OPERATION_SOURCE_MISSING",
    );
  }
  return sourceId;
}

async function getRestoreBackup(input: {
  backupId: string;
  resourceId: string;
  sourceId: string;
  workspaceId: string;
}) {
  const [backup] = await getTowbarDatabase()
    .select({
      createdAt: resourceOperations.createdAt,
      id: resourceOperations.id,
      result: resourceOperations.result,
    })
    .from(resourceOperations)
    .where(
      and(
        eq(resourceOperations.id, input.backupId),
        eq(resourceOperations.resourceId, input.resourceId),
        eq(resourceOperations.sourceId, input.sourceId),
        eq(resourceOperations.workspaceId, input.workspaceId),
        eq(resourceOperations.type, "backup"),
        eq(resourceOperations.state, "succeeded"),
        isNull(resourceOperations.deletedAt),
      ),
    )
    .limit(1);
  if (!backup) throw notFound("Retained backup");
  return {
    createdAt: backup.createdAt.toISOString(),
    id: backup.id,
    result: backupOperationResultSchema.parse(backup.result),
  };
}
