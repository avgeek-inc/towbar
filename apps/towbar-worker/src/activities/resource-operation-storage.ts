import { createSign } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

import type { S3Client } from "@aws-sdk/client-s3";

import type { BackupStorage } from "@workspace/towbar-deployer";

type BackupObjectMetadata = Awaited<ReturnType<BackupStorage["headObject"]>>;

function omitUndefinedValues(
  value: BackupObjectMetadata,
): BackupObjectMetadata {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as BackupObjectMetadata;
}

export function s3Storage(
  client: S3Client,
  providerManagedEncryption?: string,
): BackupStorage {
  return {
    deleteObject: async ({ bucket, key, versionId }) => {
      await client.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: key,
          ...(versionId ? { VersionId: versionId } : {}),
        }),
      );
    },
    download: async ({
      bucket,
      key,
      localPath,
      maximumBytes,
      signal,
      versionId,
    }) => {
      const object = await client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          ...(versionId ? { VersionId: versionId } : {}),
        }),
      );
      if (!object.Body) throw new Error("Backup object has no body");
      if (
        maximumBytes !== undefined &&
        object.ContentLength !== undefined &&
        object.ContentLength > maximumBytes
      )
        throw new Error("Backup object exceeds the permitted download size");
      await pipeline(
        object.Body as NodeJS.ReadableStream,
        byteLimit(maximumBytes),
        createWriteStream(localPath, { mode: 0o600 }),
        { signal },
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
        return omitUndefinedValues({
          backupClass: parseBackupClass(metadata["towbar-backup-class"]),
          checksum: metadata["towbar-checksum"],
          encryption:
            object.ServerSideEncryption === "aws:kms"
              ? "aws:kms"
              : object.ServerSideEncryption === "AES256"
                ? "AES256"
                : providerManagedEncryption,
          engine: parseEngine(metadata["towbar-engine"]),
          engineMajorVersion: parsePositiveInteger(
            metadata["towbar-engine-major-version"],
          ),
          exists: true,
          format: parseFormat(metadata["towbar-format"]),
          manifest: metadata["towbar-volume-manifest"],
          metadataVersion: parsePositiveInteger(
            metadata["towbar-metadata-version"],
          ),
          sizeBytes: object.ContentLength,
        });
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
      signal,
      sizeBytes,
    }) => {
      const upload = new Upload({
        client,
        leavePartsOnError: false,
        partSize: 8 * 1024 * 1024,
        queueSize: 2,
        params: {
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
        },
      });
      const abort = () => void upload.abort();
      signal?.addEventListener("abort", abort, { once: true });
      let result: Awaited<ReturnType<typeof upload.done>>;
      try {
        result = await upload.done();
      } finally {
        signal?.removeEventListener("abort", abort);
      }
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
    deleteObject: async ({ bucket, key, versionId }) => {
      const token = await getToken();
      const url = new URL(
        `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(key)}`,
      );
      if (versionId) url.searchParams.set("generation", versionId);
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        method: "DELETE",
      });
      if (!response.ok && response.status !== 404) {
        throw new Error(`GCP deleteObject failed: HTTP ${response.status}`);
      }
    },
    download: async ({ bucket, key, localPath, maximumBytes, signal }) => {
      const token = await getToken();
      const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(key)}?alt=media`;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        throw new Error(`GCP download failed: HTTP ${response.status}`);
      }
      if (!response.body) throw new Error("Backup object has no body");
      const contentLength = Number(response.headers.get("content-length"));
      if (
        maximumBytes !== undefined &&
        Number.isFinite(contentLength) &&
        contentLength > maximumBytes
      )
        throw new Error("Backup object exceeds the permitted download size");
      await pipeline(
        Readable.fromWeb(
          response.body as import("node:stream/web").ReadableStream,
        ),
        byteLimit(maximumBytes),
        createWriteStream(localPath, { mode: 0o600 }),
        { signal },
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
      return omitUndefinedValues({
        backupClass: parseBackupClass(metadata["towbar-backup-class"]),
        checksum: metadata["towbar-checksum"],
        encryption: data.kmsKeyName ? "Google-CMEK" : "Google-managed",
        engine: parseEngine(metadata["towbar-engine"]),
        engineMajorVersion: parsePositiveInteger(
          metadata["towbar-engine-major-version"],
        ),
        exists: true,
        format: parseFormat(metadata["towbar-format"]),
        manifest: metadata["towbar-volume-manifest"],
        metadataVersion: parsePositiveInteger(
          metadata["towbar-metadata-version"],
        ),
        sizeBytes: data.size ? Number(data.size) : undefined,
      });
    },
    upload: async ({ bucket, key, localPath, metadata, signal, sizeBytes }) => {
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
        signal,
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
      try {
        const putRes = await fetch(uploadUrl, {
          body: Readable.toWeb(stream) as unknown as RequestInit["body"],
          duplex: "half",
          headers: {
            "Content-Length": String(sizeBytes),
            "Content-Type": "application/octet-stream",
          },
          method: "PUT",
          signal,
        });
        if (!putRes.ok) {
          throw new Error(`GCP upload failed: HTTP ${putRes.status}`);
        }
        const data = (await putRes.json()) as { generation?: string };
        return data.generation ? { versionId: data.generation } : {};
      } catch (error) {
        await fetch(uploadUrl, {
          method: "DELETE",
          signal: AbortSignal.timeout(30_000),
        }).catch(() => undefined);
        throw error;
      }
    },
  };
}

function byteLimit(maximumBytes?: number) {
  let received = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      if (maximumBytes !== undefined && received > maximumBytes) {
        callback(
          new Error("Backup object exceeds the permitted download size"),
        );
        return;
      }
      callback(null, chunk);
    },
  });
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
  return [
    "postgres",
    "mysql",
    "mariadb",
    "mongodb",
    "redis",
    "dragonfly",
    "keydb",
    "clickhouse",
  ].includes(value ?? "")
    ? (value as import("@workspace/towbar-core").BackupOperationResult["engine"])
    : undefined;
}

function parseFormat(value: string | undefined) {
  return [
    "postgres-custom",
    "mysql-sql",
    "mariadb-sql",
    "mongodb-archive",
    "redis-rdb",
    "dragonfly-rdb",
    "keydb-rdb",
    "clickhouse-backup",
    "tar-gzip",
    "tar-zstd",
  ].includes(value ?? "")
    ? (value as
        | import("@workspace/towbar-core").BackupOperationResult["format"]
        | "tar-gzip"
        | "tar-zstd")
    : undefined;
}

function parseBackupClass(value: string | undefined) {
  return value === "database" || value === "volume" ? value : undefined;
}
