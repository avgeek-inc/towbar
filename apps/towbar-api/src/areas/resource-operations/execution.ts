import { resolveServerCredentials } from "../secrets/store.js";
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
        await resolveCloudStorageSecrets(operation);

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

async function resolveCloudStorageSecrets(operation: {
  app: unknown;
  request: { type: string };
  workspaceId: string;
}) {
  const requiresBackup = ["backup", "restore"].includes(operation.request.type);
  const backupConfig =
    operation.app &&
    typeof operation.app === "object" &&
    "backup" in operation.app
      ? (
          operation.app as {
            backup?: import("@workspace/towbar-core").NormalizedResource["backup"];
          }
        ).backup
      : undefined;

  const needsAws =
    requiresBackup &&
    (!backupConfig ||
      Boolean(backupConfig.s3) ||
      backupConfig.restoreFrom === "s3");

  const needsGcp =
    requiresBackup &&
    Boolean(backupConfig?.gcs || backupConfig?.restoreFrom === "gcs");

  const needsAzure =
    requiresBackup &&
    Boolean(
      backupConfig?.azureBlob || backupConfig?.restoreFrom === "azureBlob",
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
