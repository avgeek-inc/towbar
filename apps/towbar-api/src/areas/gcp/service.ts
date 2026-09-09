import { createSign, randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import {
  decryptCredential,
  encryptCredential,
  parseCredentialsMasterKey,
} from "@workspace/towbar-core";
import { workspaceGcpCredentials } from "@workspace/towbar-database/schema";

import { getEnv } from "../../env.js";
import { badRequest, notFound, serviceUnavailable } from "../../http/errors.js";
import { getTowbarDatabase } from "../../infrastructure/database.js";

export const gcpServiceAccountKeySchema = z
  .object({
    type: z.literal("service_account"),
    project_id: z.string().trim().min(1).max(128),
    private_key_id: z.string().trim().min(1).max(128),
    private_key: z.string().min(100),
    client_email: z.string().trim().email(),
    client_id: z.string().trim().min(1).max(128).optional(),
    auth_uri: z.string().url().optional(),
    token_uri: z.string().url().optional(),
    auth_provider_x509_cert_url: z.string().url().optional(),
    client_x509_cert_url: z.string().url().optional(),
    universe_domain: z.string().optional(),
  })
  .passthrough();

export type GcpServiceAccountKey = z.infer<typeof gcpServiceAccountKeySchema>;

export async function getGcpCredentialMetadata(workspaceId: string) {
  const [credential] = await getTowbarDatabase()
    .select({
      clientEmail: workspaceGcpCredentials.clientEmail,
      createdAt: workspaceGcpCredentials.createdAt,
      lastVerifiedAt: workspaceGcpCredentials.verifiedAt,
      projectId: workspaceGcpCredentials.projectId,
      status: workspaceGcpCredentials.verificationStatus,
      updatedAt: workspaceGcpCredentials.updatedAt,
      verificationMessage: workspaceGcpCredentials.verificationMessage,
    })
    .from(workspaceGcpCredentials)
    .where(eq(workspaceGcpCredentials.workspaceId, workspaceId))
    .limit(1);
  return credential ?? null;
}

export async function hasGcpCredentials(workspaceId: string) {
  const [credential] = await getTowbarDatabase()
    .select({ id: workspaceGcpCredentials.id })
    .from(workspaceGcpCredentials)
    .where(eq(workspaceGcpCredentials.workspaceId, workspaceId))
    .limit(1);
  return Boolean(credential);
}

export function parseGcpServiceAccountJson(raw: string): GcpServiceAccountKey {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw badRequest("Invalid JSON in service account key");
  }
  const result = gcpServiceAccountKeySchema.safeParse(parsed);
  if (!result.success) {
    throw badRequest(
      "Service account key must be a valid Google Cloud service account JSON key",
    );
  }
  return result.data;
}

export async function getGcpAccessToken(
  payload: GcpServiceAccountKey,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", typ: "JWT" }),
  ).toString("base64url");
  const claims = Buffer.from(
    JSON.stringify({
      aud: payload.token_uri ?? "https://oauth2.googleapis.com/token",
      exp: now + 3600,
      iat: now,
      iss: payload.client_email,
      scope: "https://www.googleapis.com/auth/devstorage.read_write",
    }),
  ).toString("base64url");
  const signatureInput = `${header}.${claims}`;
  let signature: string;
  try {
    const signer = createSign("RSA-SHA256");
    signer.update(signatureInput);
    signature = signer.sign(payload.private_key, "base64url");
  } catch {
    throw badRequest("Could not sign authentication token with private key");
  }
  const jwt = `${signatureInput}.${signature}`;

  const tokenUrl = payload.token_uri ?? "https://oauth2.googleapis.com/token";
  const body = new URLSearchParams({
    assertion: jwt,
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
  });

  try {
    const response = await fetch(tokenUrl, {
      body: body.toString(),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      method: "POST",
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw serviceUnavailable("Google Cloud rejected these credentials", {
        cause: new Error(errorText || `HTTP ${response.status}`),
      });
    }

    const data = (await response.json()) as { access_token?: string };
    if (!data.access_token) {
      throw serviceUnavailable("Google Cloud did not return an access token");
    }
    return data.access_token;
  } catch (error) {
    if (error instanceof Error && error.message.includes("rejected")) {
      throw error;
    }
    throw serviceUnavailable(
      "Could not connect to Google Cloud auth endpoint",
      { cause: error },
    );
  }
}

export async function validateGcpCredentials(payload: GcpServiceAccountKey) {
  await getGcpAccessToken(payload);
  return {
    clientEmail: payload.client_email,
    projectId: payload.project_id,
  };
}

export async function saveGcpCredentials(input: {
  serviceAccountKey: string;
  workspaceId: string;
}) {
  const payload = parseGcpServiceAccountJson(input.serviceAccountKey);
  const identity = await validateGcpCredentials(payload);
  const verifiedAt = new Date();
  const database = getTowbarDatabase();
  const [existing] = await database
    .select({ id: workspaceGcpCredentials.id })
    .from(workspaceGcpCredentials)
    .where(eq(workspaceGcpCredentials.workspaceId, input.workspaceId))
    .limit(1);
  const id = existing?.id ?? randomUUID();
  const encryptedPayload = encryptCredential({
    associatedData: gcpCredentialAssociatedData(input.workspaceId, id),
    masterKey: parseCredentialsMasterKey(getEnv().TOWBAR_CREDENTIALS_KEY),
    value: payload,
  });
  const values = {
    clientEmail: identity.clientEmail,
    encryptedPayload,
    id,
    projectId: identity.projectId,
    updatedAt: new Date(),
    verificationMessage: `GCP project ${identity.projectId} (${identity.clientEmail})`,
    verificationStatus: "verified" as const,
    verifiedAt,
    workspaceId: input.workspaceId,
  };
  if (existing) {
    await database
      .update(workspaceGcpCredentials)
      .set(values)
      .where(eq(workspaceGcpCredentials.id, existing.id));
  } else {
    await database.insert(workspaceGcpCredentials).values(values);
  }
  return await getGcpCredentialMetadata(input.workspaceId);
}

export async function reverifyGcpCredentials(workspaceId: string) {
  const metadata = await getGcpCredentialMetadata(workspaceId);
  if (!metadata) return;
  let verificationStatus: "verified" | "failed" = "verified";
  let verificationMessage: string;
  try {
    const credential = await getDecryptedGcpCredential({ workspaceId });
    const identity = await validateGcpCredentials(credential.payload);
    verificationMessage = `GCP project ${identity.projectId} (${identity.clientEmail})`;
  } catch {
    verificationStatus = "failed";
    verificationMessage =
      "Google Cloud could not verify the connected credentials. Check the service account key.";
  }
  await getTowbarDatabase()
    .update(workspaceGcpCredentials)
    .set({ verificationStatus, verificationMessage, verifiedAt: new Date() })
    .where(
      and(
        eq(workspaceGcpCredentials.workspaceId, workspaceId),
        eq(workspaceGcpCredentials.updatedAt, metadata.updatedAt),
      ),
    );
}

export async function deleteGcpCredentials(workspaceId: string) {
  await getTowbarDatabase()
    .delete(workspaceGcpCredentials)
    .where(eq(workspaceGcpCredentials.workspaceId, workspaceId));
}

export async function getDecryptedGcpCredential(input: {
  workspaceId: string;
}) {
  const [credential] = await getTowbarDatabase()
    .select()
    .from(workspaceGcpCredentials)
    .where(eq(workspaceGcpCredentials.workspaceId, input.workspaceId))
    .limit(1);
  if (!credential) throw notFound("GCP credentials");
  const payload = gcpServiceAccountKeySchema.parse(
    decryptCredential({
      associatedData: gcpCredentialAssociatedData(
        input.workspaceId,
        credential.id,
      ),
      envelope: credential.encryptedPayload,
      masterKey: parseCredentialsMasterKey(getEnv().TOWBAR_CREDENTIALS_KEY),
    }),
  );
  return {
    id: credential.id,
    payload,
    projectId: credential.projectId,
  };
}

function gcpCredentialAssociatedData(workspaceId: string, recordId: string) {
  return `${workspaceId}:workspace:gcp-credentials:${recordId}`;
}
