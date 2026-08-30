import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { ApplicationFailure, Context } from "@temporalio/activity";

import { executeResourceOperation } from "@workspace/towbar-deployer";
import { isNormalizedResource } from "@workspace/towbar-core";

import { signedApiRequest } from "../infrastructure/towbar-api.js";
import { getEnv } from "../env.js";

import type {
  BackupStorage,
  ResourceOperationExecutionContext,
  ResourceOperationSecrets,
} from "@workspace/towbar-deployer";

export async function executeResourceOperationActivity(operationId: string) {
  const activity = Context.current();
  const pulse = setInterval(() => activity.heartbeat({ operationId }), 10_000);
  let client: S3Client | undefined;
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
    let storage: BackupStorage | undefined;
    if (secrets.aws) {
      const configuredRegion =
        (context.deployable && isNormalizedResource(context.deployable)
          ? context.deployable.backup?.s3.region
          : undefined) ?? secrets.aws.region;
      client = new S3Client({
        credentials: {
          accessKeyId: secrets.aws.accessKeyId,
          secretAccessKey: secrets.aws.secretAccessKey,
        },
        region: configuredRegion,
      });
      storage = s3Storage(client);
    }
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
      ...(storage ? { storage } : {}),
      signal: activity.cancellationSignal,
    });
    await signedApiRequest(
      "POST",
      `/v1/internal/resource-operations/${operationId}/events`,
      { result, state: "succeeded" },
    );
  } catch (error) {
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
  } finally {
    clearInterval(pulse);
    client?.destroy();
  }
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

function s3Storage(client: S3Client): BackupStorage {
  return {
    deleteObject: async ({ bucket, key }) => {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
    download: async ({ bucket, key, localPath, versionId }) => {
      const object = await client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          ...(versionId ? { VersionId: versionId } : {}),
        }),
      );
      if (!object.Body) throw new Error("Backup object has no body");
      await pipeline(
        object.Body as NodeJS.ReadableStream,
        createWriteStream(localPath, { mode: 0o600 }),
      );
    },
    headObject: async ({ bucket, key, versionId }) => {
      try {
        const object = await client.send(
          new HeadObjectCommand({
            Bucket: bucket,
            Key: key,
            ...(versionId ? { VersionId: versionId } : {}),
          }),
        );
        const metadata = object.Metadata ?? {};
        return {
          checksum: metadata["towbar-checksum"],
          encryption:
            object.ServerSideEncryption === "aws:kms"
              ? "aws:kms"
              : object.ServerSideEncryption === "AES256"
                ? "AES256"
                : undefined,
          engine: parseEngine(metadata["towbar-engine"]),
          engineMajorVersion: parsePositiveInteger(
            metadata["towbar-engine-major-version"],
          ),
          exists: true,
          format: parseFormat(metadata["towbar-format"]),
          metadataVersion: parsePositiveInteger(
            metadata["towbar-metadata-version"],
          ),
          sizeBytes: object.ContentLength,
        };
      } catch (error) {
        if (isS3ObjectMissing(error)) return { exists: false };
        throw error;
      }
    },
    upload: async ({
      bucket,
      encryption,
      key,
      kmsKeyId,
      localPath,
      metadata,
      sizeBytes,
    }) => {
      const result = await client.send(
        new PutObjectCommand({
          Body: createReadStream(localPath),
          Bucket: bucket,
          ContentLength: sizeBytes,
          Key: key,
          Metadata: metadata,
          ServerSideEncryption: encryption,
          ...(kmsKeyId ? { SSEKMSKeyId: kmsKeyId } : {}),
        }),
      );
      return result.VersionId ? { versionId: result.VersionId } : {};
    },
  };
}

function parsePositiveInteger(value: string | undefined) {
  if (!value || !/^\d+$/u.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function isS3ObjectMissing(error: unknown) {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as {
    $metadata?: { httpStatusCode?: number };
    name?: string;
  };
  return (
    candidate.$metadata?.httpStatusCode === 404 ||
    candidate.name === "NoSuchKey" ||
    candidate.name === "NotFound"
  );
}

function parseEngine(value: string | undefined) {
  return value === "postgres" || value === "redis" ? value : undefined;
}

function parseFormat(value: string | undefined) {
  return value === "postgres-custom" || value === "redis-rdb"
    ? value
    : undefined;
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
