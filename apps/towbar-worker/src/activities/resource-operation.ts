import { createSign } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { Readable } from "node:stream";
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
    const storages: Partial<Record<import("@workspace/towbar-core").BackupProvider, BackupStorage>> = {};
    if (secrets.aws) {
      const configuredRegion =
        (context.deployable && isNormalizedResource(context.deployable)
          ? context.deployable.backup?.s3?.region
          : undefined) ?? secrets.aws.region;
      client = new S3Client({
        credentials: {
          accessKeyId: secrets.aws.accessKeyId,
          secretAccessKey: secrets.aws.secretAccessKey,
        },
        region: configuredRegion,
      });
      storage = s3Storage(client);
      storages.s3 = storage;
    }
    if (secrets.gcp) {
      const gcp = gcsStorage(
        JSON.parse(secrets.gcp.serviceAccountKey) as {
          client_email: string;
          private_key: string;
          token_uri?: string;
        },
      );
      storages.gcs = gcp;
      if (
        !storage ||
        (context.deployable &&
          isNormalizedResource(context.deployable) &&
          context.deployable.backup?.restoreFrom === "gcs") ||
        (context.restoreBackup &&
          context.restoreBackup.result.restoreFrom === "gcs")
      ) {
        storage = gcp;
      }
    }
    if (secrets.azure) {
      const defaultStorageAccount =
        (context.deployable && isNormalizedResource(context.deployable)
          ? context.deployable.backup?.azureBlob?.storageAccount
          : undefined) ??
        context.restoreBackup?.result.storageAccount ??
        context.restoreBackup?.result.destinations?.find(
          (d) => d.provider === "azureBlob",
        )?.storageAccount;
      const azure = azureBlobStorage(secrets.azure, defaultStorageAccount);
      storages.azureBlob = azure;
      if (
        !storage ||
        (context.deployable &&
          isNormalizedResource(context.deployable) &&
          context.deployable.backup?.restoreFrom === "azureBlob") ||
        (context.restoreBackup &&
          (context.restoreBackup.result.restoreFrom === "azureBlob" ||
            (!context.restoreBackup.result.restoreFrom &&
              Boolean(context.restoreBackup.result.storageAccount))))
      ) {
        storage = azure;
      }
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
      ...(storage ? { storage, storages } : {}),
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
          ServerSideEncryption:
            encryption === "aws:kms" || encryption === "AES256"
              ? encryption
              : undefined,
          ...(kmsKeyId ? { SSEKMSKeyId: kmsKeyId } : {}),
        }),
      );
      return result.VersionId ? { versionId: result.VersionId } : {};
    },
  };
}

function gcsStorage(serviceAccountKey: {
  client_email: string;
  private_key: string;
  token_uri?: string;
}): BackupStorage {
  let cachedToken: { expiresAt: number; token: string } | null = null;

  async function getToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (cachedToken && cachedToken.expiresAt > now + 60) {
      return cachedToken.token;
    }
    const header = Buffer.from(
      JSON.stringify({ alg: "RS256", typ: "JWT" }),
    ).toString("base64url");
    const claims = Buffer.from(
      JSON.stringify({
        aud:
          serviceAccountKey.token_uri ??
          "https://oauth2.googleapis.com/token",
        exp: now + 3600,
        iat: now,
        iss: serviceAccountKey.client_email,
        scope: "https://www.googleapis.com/auth/devstorage.read_write",
      }),
    ).toString("base64url");
    const signatureInput = `${header}.${claims}`;
    const signer = createSign("RSA-SHA256");
    signer.update(signatureInput);
    const signature = signer.sign(serviceAccountKey.private_key, "base64url");
    const jwt = `${signatureInput}.${signature}`;

    const tokenUrl =
      serviceAccountKey.token_uri ?? "https://oauth2.googleapis.com/token";
    const body = new URLSearchParams({
      assertion: jwt,
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    });

    const response = await fetch(tokenUrl, {
      body: body.toString(),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      method: "POST",
    });

    if (!response.ok) {
      throw new Error(`GCP auth failed: HTTP ${response.status}`);
    }

    const data = (await response.json()) as {
      access_token: string;
      expires_in?: number;
    };
    cachedToken = {
      expiresAt: now + (data.expires_in ?? 3600),
      token: data.access_token,
    };
    return data.access_token;
  }

  return {
    deleteObject: async ({ bucket, key }) => {
      const token = await getToken();
      const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(key)}`;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        method: "DELETE",
      });
      if (!response.ok && response.status !== 404) {
        throw new Error(`GCP deleteObject failed: HTTP ${response.status}`);
      }
    },
    download: async ({ bucket, key, localPath }) => {
      const token = await getToken();
      const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(key)}?alt=media`;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        throw new Error(`GCP download failed: HTTP ${response.status}`);
      }
      if (!response.body) throw new Error("Backup object has no body");
      await pipeline(
        Readable.fromWeb(
          response.body as import("node:stream/web").ReadableStream,
        ),
        createWriteStream(localPath, { mode: 0o600 }),
      );
    },
    headObject: async ({ bucket, key }) => {
      const token = await getToken();
      const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(key)}`;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status === 404) return { exists: false };
      if (!response.ok) {
        throw new Error(`GCP headObject failed: HTTP ${response.status}`);
      }
      const data = (await response.json()) as {
        generation?: string;
        kmsKeyName?: string;
        metadata?: Record<string, string>;
        size?: string;
      };
      const metadata = data.metadata ?? {};
      return {
        checksum: metadata["towbar-checksum"],
        encryption: data.kmsKeyName ? "Google-CMEK" : "Google-managed",
        engine: parseEngine(metadata["towbar-engine"]),
        engineMajorVersion: parsePositiveInteger(
          metadata["towbar-engine-major-version"],
        ),
        exists: true,
        format: parseFormat(metadata["towbar-format"]),
        metadataVersion: parsePositiveInteger(
          metadata["towbar-metadata-version"],
        ),
        sizeBytes: data.size ? Number(data.size) : undefined,
      };
    },
    upload: async ({ bucket, key, localPath, metadata, sizeBytes }) => {
      const token = await getToken();
      const initUrl = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?uploadType=resumable&name=${encodeURIComponent(key)}`;
      const initRes = await fetch(initUrl, {
        body: JSON.stringify({ metadata }),
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Length": String(sizeBytes),
          "X-Upload-Content-Type": "application/octet-stream",
        },
        method: "POST",
      });
      if (!initRes.ok) {
        throw new Error(
          `GCP upload session init failed: HTTP ${initRes.status}`,
        );
      }
      const uploadUrl = initRes.headers.get("Location");
      if (!uploadUrl) {
        throw new Error("GCP upload session did not return Location header");
      }

      const stream = createReadStream(localPath);
      const putRes = await fetch(uploadUrl, {
        body: Readable.toWeb(stream) as unknown as RequestInit["body"],
        duplex: "half",
        headers: {
          "Content-Length": String(sizeBytes),
          "Content-Type": "application/octet-stream",
        },
        method: "PUT",
      });
      if (!putRes.ok) {
        throw new Error(`GCP upload failed: HTTP ${putRes.status}`);
      }
      const data = (await putRes.json()) as { generation?: string };
      return data.generation ? { versionId: data.generation } : {};
    },
  };
}

function azureBlobStorage(
  credential: import("@workspace/towbar-deployer").WorkspaceAzureCredential,
  defaultStorageAccount?: string,
): BackupStorage {
  let cachedToken: { expiresAt: number; token: string } | null = null;

  async function getToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (cachedToken && cachedToken.expiresAt > now + 60) {
      return cachedToken.token;
    }
    const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(credential.tenantId)}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
      client_id: credential.clientId,
      client_secret: credential.clientSecret,
      grant_type: "client_credentials",
      scope: "https://storage.azure.com/.default",
    });
    const response = await fetch(tokenUrl, {
      body: body.toString(),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      method: "POST",
    });
    if (!response.ok) {
      throw new Error(`Azure auth failed: HTTP ${response.status}`);
    }
    const data = (await response.json()) as {
      access_token: string;
      expires_in?: number;
    };
    cachedToken = {
      expiresAt: now + (data.expires_in ?? 3600),
      token: data.access_token,
    };
    return data.access_token;
  }

  function resolveUrl(
    storageAccount: string | undefined,
    container: string,
    key: string,
  ) {
    const account = storageAccount ?? defaultStorageAccount;
    if (!account) {
      throw new Error("Azure storage account name is required");
    }
    const encodedKey = key.split("/").map(encodeURIComponent).join("/");
    return `https://${encodeURIComponent(account)}.blob.core.windows.net/${encodeURIComponent(container)}/${encodedKey}`;
  }

  return {
    deleteObject: async ({ bucket, key, storageAccount }) => {
      const token = await getToken();
      const url = resolveUrl(storageAccount, bucket, key);
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          "x-ms-version": "2024-11-04",
        },
        method: "DELETE",
      });
      if (!response.ok && response.status !== 404) {
        throw new Error(`Azure deleteObject failed: HTTP ${response.status}`);
      }
    },
    download: async ({ bucket, key, localPath, storageAccount }) => {
      const token = await getToken();
      const url = resolveUrl(storageAccount, bucket, key);
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          "x-ms-version": "2024-11-04",
        },
      });
      if (!response.ok) {
        throw new Error(`Azure download failed: HTTP ${response.status}`);
      }
      if (!response.body) throw new Error("Backup object has no body");
      await pipeline(
        Readable.fromWeb(
          response.body as import("node:stream/web").ReadableStream,
        ),
        createWriteStream(localPath, { mode: 0o600 }),
      );
    },
    headObject: async ({ bucket, key, storageAccount }) => {
      const token = await getToken();
      const url = resolveUrl(storageAccount, bucket, key);
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          "x-ms-version": "2024-11-04",
        },
        method: "HEAD",
      });
      if (response.status === 404) return { exists: false };
      if (!response.ok) {
        throw new Error(`Azure headObject failed: HTTP ${response.status}`);
      }
      const headers = response.headers;
      const contentLength = headers.get("content-length");
      return {
        checksum: headers.get("x-ms-meta-towbar-checksum") ?? undefined,
        encryption:
          headers.get("x-ms-server-encrypted") === "true"
            ? "Microsoft-managed"
            : undefined,
        engine: parseEngine(
          headers.get("x-ms-meta-towbar-engine") ?? undefined,
        ),
        engineMajorVersion: parsePositiveInteger(
          headers.get("x-ms-meta-towbar-engine-major-version") ?? undefined,
        ),
        exists: true,
        format: parseFormat(
          headers.get("x-ms-meta-towbar-format") ?? undefined,
        ),
        metadataVersion: parsePositiveInteger(
          headers.get("x-ms-meta-towbar-metadata-version") ?? undefined,
        ),
        sizeBytes: contentLength ? Number(contentLength) : undefined,
      };
    },
    upload: async ({
      bucket,
      key,
      localPath,
      metadata,
      sizeBytes,
      storageAccount,
    }) => {
      const token = await getToken();
      const url = resolveUrl(storageAccount, bucket, key);
      const metaHeaders: Record<string, string> = {};
      for (const [k, v] of Object.entries(metadata)) {
        metaHeaders[`x-ms-meta-${k}`] = v;
      }
      const stream = createReadStream(localPath);
      const response = await fetch(url, {
        body: Readable.toWeb(stream) as unknown as RequestInit["body"],
        duplex: "half",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Length": String(sizeBytes),
          "Content-Type": "application/octet-stream",
          "x-ms-blob-type": "BlockBlob",
          "x-ms-version": "2024-11-04",
          ...metaHeaders,
        },
        method: "PUT",
      });
      if (!response.ok) {
        throw new Error(`Azure upload failed: HTTP ${response.status}`);
      }
      const versionId = response.headers.get("x-ms-version-id") ?? undefined;
      return versionId ? { versionId } : {};
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
