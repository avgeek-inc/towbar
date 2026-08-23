import { createReadStream } from "node:fs";

import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { ApplicationFailure, Context } from "@temporalio/activity";

import { executeResourceOperation } from "@workspace/towbar-deployer";
import { isNormalizedResource } from "@workspace/towbar-core";

import { signedApiRequest } from "../infrastructure/towbar-api.js";

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
    await signedApiRequest(
      "POST",
      `/v1/internal/resource-operations/${operationId}/events`,
      {
        errorCode: classifyError(error),
        errorMessage: safeErrorMessage(error),
        state: "failed",
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
  await signedApiRequest("POST", "/v1/internal/maintenance/sweep");
}

function s3Storage(client: S3Client): BackupStorage {
  return {
    deleteObject: async ({ bucket, key }) => {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
    upload: async ({
      bucket,
      encryption,
      key,
      kmsKeyId,
      localPath,
      sizeBytes,
    }) => {
      await client.send(
        new PutObjectCommand({
          Body: createReadStream(localPath),
          Bucket: bucket,
          ContentLength: sizeBytes,
          Key: key,
          ServerSideEncryption: encryption,
          ...(kmsKeyId ? { SSEKMSKeyId: kmsKeyId } : {}),
        }),
      );
    },
  };
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
