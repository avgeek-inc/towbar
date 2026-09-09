import { createSign } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { open } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";

import type { S3Client } from "@aws-sdk/client-s3";

import type {
  BackupStorage,
  WorkspaceAzureCredential,
} from "@workspace/towbar-deployer";

export function s3Storage(client: S3Client): BackupStorage {
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

export function gcsStorage(serviceAccountKey: {
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
          serviceAccountKey.token_uri ?? "https://oauth2.googleapis.com/token",
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

export function azureBlobStorage(
  credential: WorkspaceAzureCredential,
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
      if (sizeBytes > MAX_AZURE_SINGLE_PUT_BYTES) {
        return await uploadAzureBlockBlobChunked({
          localPath,
          metaHeaders,
          sizeBytes,
          token,
          url,
        });
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

const MAX_AZURE_SINGLE_PUT_BYTES = 256 * 1024 * 1024;
const AZURE_BLOCK_SIZE = 32 * 1024 * 1024;

async function uploadAzureBlockBlobChunked(params: {
  localPath: string;
  metaHeaders: Record<string, string>;
  sizeBytes: number;
  token: string;
  url: string;
}): Promise<{ versionId?: string }> {
  const fileHandle = await open(params.localPath, "r");
  const blockIds: string[] = [];
  try {
    let offset = 0;
    let blockIndex = 0;
    const buffer = Buffer.alloc(AZURE_BLOCK_SIZE);
    while (offset < params.sizeBytes) {
      const bytesToRead = Math.min(AZURE_BLOCK_SIZE, params.sizeBytes - offset);
      const { bytesRead } = await fileHandle.read(
        buffer,
        0,
        bytesToRead,
        offset,
      );
      if (bytesRead === 0) break;
      const blockId = Buffer.from(String(blockIndex).padStart(6, "0")).toString(
        "base64",
      );
      const blockUrl = `${params.url}?comp=block&blockid=${encodeURIComponent(blockId)}`;
      const chunk = buffer.subarray(0, bytesRead);
      const blockRes = await fetch(blockUrl, {
        body: chunk,
        headers: {
          Authorization: `Bearer ${params.token}`,
          "Content-Length": String(bytesRead),
          "Content-Type": "application/octet-stream",
          "x-ms-version": "2024-11-04",
        },
        method: "PUT",
      });
      if (!blockRes.ok) {
        throw new Error(`Azure Put Block failed: HTTP ${blockRes.status}`);
      }
      blockIds.push(blockId);
      offset += bytesRead;
      blockIndex++;
    }
  } finally {
    await fileHandle.close();
  }

  const blockListXml = `<?xml version="1.0" encoding="utf-8"?><BlockList>${blockIds.map((id) => `<Latest>${id}</Latest>`).join("")}</BlockList>`;
  const blockListUrl = `${params.url}?comp=blocklist`;
  const putListRes = await fetch(blockListUrl, {
    body: blockListXml,
    headers: {
      Authorization: `Bearer ${params.token}`,
      "Content-Length": String(Buffer.byteLength(blockListXml)),
      "Content-Type": "application/xml",
      "x-ms-version": "2024-11-04",
      ...params.metaHeaders,
    },
    method: "PUT",
  });
  if (!putListRes.ok) {
    throw new Error(`Azure Put Block List failed: HTTP ${putListRes.status}`);
  }
  const versionId = putListRes.headers.get("x-ms-version-id") ?? undefined;
  return versionId ? { versionId } : {};
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
