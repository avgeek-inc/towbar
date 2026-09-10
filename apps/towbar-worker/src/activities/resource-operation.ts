import { S3Client } from "@aws-sdk/client-s3";
import { ApplicationFailure, Context } from "@temporalio/activity";

import { executeResourceOperation } from "@workspace/towbar-deployer";
import { isNormalizedResource } from "@workspace/towbar-core";

import { signedApiRequest } from "../infrastructure/towbar-api.js";
import { getEnv } from "../env.js";
import {
  azureBlobStorage,
  gcsStorage,
  s3Storage,
} from "./resource-operation-storage.js";

import type {
  BackupStorage,
  ResourceOperationExecutionContext,
  ResourceOperationSecrets,
} from "@workspace/towbar-deployer";
import type { BackupProvider } from "@workspace/towbar-core";

export async function executeResourceOperationActivity(operationId: string) {
  const activity = Context.current();
  const pulse = setInterval(() => activity.heartbeat({ operationId }), 10_000);
  let s3Client: S3Client | undefined;
  try {
    const [contextResponse, secretsResponse] = await Promise.all([
      signedApiRequest<{ context: ResourceOperationExecutionContext }>(
        "GET",
        `/v1/internal/resource-operations/${operationId}/context`,
      ),
      signedApiRequest<{ secrets: ResourceOperationSecrets }>(
        "POST",
        `/v1/internal/resource-operations/${operationId}/secrets/resolve`,
      ),
    ]);
    const { context } = contextResponse;
    const { secrets } = secretsResponse;

    const { client, storage, storages } = initializeBackupStorages(
      context,
      secrets,
    );
    s3Client = client;

    const result = await executeResourceOperation({
      context,
      hooks: {
        progress: async (progress) => {
          await signedApiRequest(
            "POST",
            `/v1/internal/resource-operations/${operationId}/progress`,
            progress,
          );
        },
      },
      secrets,
      ...(storage ? { storage, storages } : {}),
      signal: activity.cancellationSignal,
    });
    await signedApiRequest(
      "POST",
      `/v1/internal/resource-operations/${operationId}/events`,
      { result, state: "succeeded" },
    );
  } catch (error) {
    await handleResourceOperationError(operationId, error);
  } finally {
    clearInterval(pulse);
    s3Client?.destroy();
  }
}

function initAwsStorage(
  context: ResourceOperationExecutionContext,
  awsSecret: NonNullable<ResourceOperationSecrets["aws"]>,
) {
  const configuredRegion =
    (context.deployable && isNormalizedResource(context.deployable)
      ? context.deployable.backup?.s3?.region
      : undefined) ?? awsSecret.region;
  const client = new S3Client({
    credentials: {
      accessKeyId: awsSecret.accessKeyId,
      secretAccessKey: awsSecret.secretAccessKey,
    },
    region: configuredRegion,
  });
  return { client, storage: s3Storage(client) };
}

function initGcpStorage(
  context: ResourceOperationExecutionContext,
  gcpSecret: NonNullable<ResourceOperationSecrets["gcp"]>,
  currentStorage?: BackupStorage,
) {
  const parsedKey = JSON.parse(gcpSecret.serviceAccountKey) as {
    client_email: string;
    private_key: string;
    token_uri?: string;
  };
  const gcs = gcsStorage(parsedKey);
  const isPrimary =
    (context.deployable &&
      isNormalizedResource(context.deployable) &&
      context.deployable.backup?.restoreFrom === "gcs") ||
    context.restoreBackup?.result.restoreFrom === "gcs";
  return {
    gcs,
    storage: !currentStorage || isPrimary ? gcs : currentStorage,
  };
}

function initAzureStorage(
  context: ResourceOperationExecutionContext,
  azureSecret: NonNullable<ResourceOperationSecrets["azure"]>,
  currentStorage?: BackupStorage,
) {
  const defaultStorageAccount =
    (context.deployable && isNormalizedResource(context.deployable)
      ? context.deployable.backup?.azureBlob?.storageAccount
      : undefined) ??
    context.restoreBackup?.result.storageAccount ??
    context.restoreBackup?.result.destinations?.find(
      (d) => d.provider === "azureBlob",
    )?.storageAccount;
  const azure = azureBlobStorage(azureSecret, defaultStorageAccount);

  const isPrimary =
    (context.deployable &&
      isNormalizedResource(context.deployable) &&
      context.deployable.backup?.restoreFrom === "azureBlob") ||
    (context.restoreBackup &&
      (context.restoreBackup.result.restoreFrom === "azureBlob" ||
        (!context.restoreBackup.result.restoreFrom &&
          Boolean(context.restoreBackup.result.storageAccount))));

  return {
    azure,
    storage: !currentStorage || isPrimary ? azure : currentStorage,
  };
}

function initializeBackupStorages(
  context: ResourceOperationExecutionContext,
  secrets: ResourceOperationSecrets,
): {
  client?: S3Client;
  storage?: BackupStorage;
  storages: Partial<Record<BackupProvider, BackupStorage>>;
} {
  let client: S3Client | undefined;
  let storage: BackupStorage | undefined;
  const storages: Partial<Record<BackupProvider, BackupStorage>> = {};

  if (secrets.aws) {
    const aws = initAwsStorage(context, secrets.aws);
    client = aws.client;
    storage = aws.storage;
    storages.s3 = aws.storage;
  }

  if (secrets.gcp) {
    const gcp = initGcpStorage(context, secrets.gcp, storage);
    storages.gcs = gcp.gcs;
    storage = gcp.storage;
  }

  if (secrets.azure) {
    const azure = initAzureStorage(context, secrets.azure, storage);
    storages.azureBlob = azure.azure;
    storage = azure.storage;
  }

  return { client, storage, storages };
}

async function handleResourceOperationError(
  operationId: string,
  error: unknown,
): Promise<never> {
  const cancelled = error instanceof Error && error.name === "AbortError";
  const result = restoreFailureResult(error);
  await signedApiRequest(
    "POST",
    `/v1/internal/resource-operations/${operationId}/events`,
    {
      errorCode: classifyError(error),
      errorMessage: safeErrorMessage(error),
      ...(result ? { result } : {}),
      state: cancelled ? "cancelled" : "failed",
    },
  ).catch(() => undefined);
  throw ApplicationFailure.create({
    message: safeErrorMessage(error),
    type: classifyError(error),
  });
}

export async function markResourceOperationInterruptedActivity(
  operationId: string,
) {
  await signedApiRequest(
    "POST",
    `/v1/internal/resource-operations/${operationId}/events`,
    {
      errorCode: "RESOURCE_OPERATION_INTERRUPTED",
      errorMessage: "The worker stopped before this operation completed",
      state: "failed",
    },
  );
}

export async function runMaintenanceSweepActivity() {
  await signedApiRequest("POST", "/v1/internal/maintenance/sweep", {
    version: getEnv().SOURCE_COMMIT,
  });
}

function restoreFailureResult(error: unknown) {
  if (typeof error === "object" && error !== null && "restoreResult" in error) {
    return (error as { restoreResult: unknown }).restoreResult;
  }
  return undefined;
}

function classifyError(error: unknown) {
  if (error instanceof Error && error.name === "AbortError") {
    return "RESOURCE_OPERATION_CANCELLED";
  }
  return "RESOURCE_OPERATION_FAILED";
}

function safeErrorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
        .replace(/Bearer\s+\S+/giu, "Bearer [REDACTED]")
        .slice(0, 1_000)
    : "Resource operation failed";
}
