import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import {
  decryptCredential,
  encryptCredential,
  parseCredentialsMasterKey,
} from "@workspace/towbar-core";
import { workspaceAzureCredentials } from "@workspace/towbar-database/schema";

import { getEnv } from "../../env.js";
import { HttpError, notFound, serviceUnavailable } from "../../http/errors.js";
import { getTowbarDatabase } from "../../infrastructure/database.js";

export const azureCredentialPayloadSchema = z
  .object({
    clientId: z.string().trim().min(8).max(64),
    clientSecret: z.string().min(10).max(256),
    tenantId: z.string().trim().min(8).max(64),
  })
  .strict();

export type AzureCredentialPayload = z.infer<
  typeof azureCredentialPayloadSchema
>;

export async function getAzureCredentialMetadata(workspaceId: string) {
  const [credential] = await getTowbarDatabase()
    .select({
      clientId: workspaceAzureCredentials.clientId,
      clientSecretSuffix: workspaceAzureCredentials.clientSecretSuffix,
      createdAt: workspaceAzureCredentials.createdAt,
      lastVerifiedAt: workspaceAzureCredentials.verifiedAt,
      status: workspaceAzureCredentials.verificationStatus,
      tenantId: workspaceAzureCredentials.tenantId,
      updatedAt: workspaceAzureCredentials.updatedAt,
      verificationMessage: workspaceAzureCredentials.verificationMessage,
    })
    .from(workspaceAzureCredentials)
    .where(eq(workspaceAzureCredentials.workspaceId, workspaceId))
    .limit(1);
  return credential ?? null;
}

export async function hasAzureCredentials(workspaceId: string) {
  const [credential] = await getTowbarDatabase()
    .select({ id: workspaceAzureCredentials.id })
    .from(workspaceAzureCredentials)
    .where(eq(workspaceAzureCredentials.workspaceId, workspaceId))
    .limit(1);
  return Boolean(credential);
}

export async function getAzureAccessToken(
  payload: AzureCredentialPayload,
): Promise<string> {
  const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(payload.tenantId)}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: payload.clientId,
    client_secret: payload.clientSecret,
    grant_type: "client_credentials",
    scope: "https://storage.azure.com/.default",
  });

  try {
    const response = await fetch(tokenUrl, {
      body: body.toString(),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      method: "POST",
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw serviceUnavailable("Azure rejected these credentials", {
        cause: new Error(errorText || `HTTP ${response.status}`),
      });
    }

    const data = (await response.json()) as { access_token?: string };
    if (!data.access_token) {
      throw serviceUnavailable("Azure did not return an access token");
    }
    return data.access_token;
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    throw serviceUnavailable(
      "Could not connect to Microsoft Entra ID auth endpoint",
      { cause: error },
    );
  }
}

export async function validateAzureCredentials(
  payload: AzureCredentialPayload,
) {
  await getAzureAccessToken(payload);
  return {
    clientId: payload.clientId,
    tenantId: payload.tenantId,
  };
}

export async function saveAzureCredentials(input: {
  clientId: string;
  clientSecret: string;
  tenantId: string;
  workspaceId: string;
}) {
  const payload = azureCredentialPayloadSchema.parse({
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    tenantId: input.tenantId,
  });
  const identity = await validateAzureCredentials(payload);
  const verifiedAt = new Date();
  const database = getTowbarDatabase();
  const [existing] = await database
    .select({ id: workspaceAzureCredentials.id })
    .from(workspaceAzureCredentials)
    .where(eq(workspaceAzureCredentials.workspaceId, input.workspaceId))
    .limit(1);
  const id = existing?.id ?? randomUUID();
  const encryptedPayload = encryptCredential({
    associatedData: azureCredentialAssociatedData(input.workspaceId, id),
    masterKey: parseCredentialsMasterKey(getEnv().TOWBAR_CREDENTIALS_KEY),
    value: payload,
  });
  const values = {
    clientId: identity.clientId,
    clientSecretSuffix: payload.clientSecret.slice(-4),
    encryptedPayload,
    id,
    tenantId: identity.tenantId,
    updatedAt: new Date(),
    verificationMessage: `Azure tenant ${identity.tenantId} (client ${identity.clientId})`,
    verificationStatus: "verified" as const,
    verifiedAt,
    workspaceId: input.workspaceId,
  };
  if (existing) {
    await database
      .update(workspaceAzureCredentials)
      .set(values)
      .where(eq(workspaceAzureCredentials.id, existing.id));
  } else {
    await database.insert(workspaceAzureCredentials).values(values);
  }
  return await getAzureCredentialMetadata(input.workspaceId);
}

export async function reverifyAzureCredentials(workspaceId: string) {
  const metadata = await getAzureCredentialMetadata(workspaceId);
  if (!metadata) return;
  let verificationStatus: "verified" | "failed" = "verified";
  let verificationMessage: string;
  try {
    const credential = await getDecryptedAzureCredential({ workspaceId });
    const identity = await validateAzureCredentials(credential.payload);
    verificationMessage = `Azure tenant ${identity.tenantId} (client ${identity.clientId})`;
  } catch {
    verificationStatus = "failed";
    verificationMessage =
      "Azure could not verify the connected credentials. Check the tenant ID, client ID, and secret.";
  }
  await getTowbarDatabase()
    .update(workspaceAzureCredentials)
    .set({ verificationStatus, verificationMessage, verifiedAt: new Date() })
    .where(
      and(
        eq(workspaceAzureCredentials.workspaceId, workspaceId),
        eq(workspaceAzureCredentials.updatedAt, metadata.updatedAt),
      ),
    );
}

export async function deleteAzureCredentials(workspaceId: string) {
  await getTowbarDatabase()
    .delete(workspaceAzureCredentials)
    .where(eq(workspaceAzureCredentials.workspaceId, workspaceId));
}

export async function getDecryptedAzureCredential(input: {
  workspaceId: string;
}) {
  const [credential] = await getTowbarDatabase()
    .select()
    .from(workspaceAzureCredentials)
    .where(eq(workspaceAzureCredentials.workspaceId, input.workspaceId))
    .limit(1);
  if (!credential) throw notFound("Azure credentials");
  const payload = azureCredentialPayloadSchema.parse(
    decryptCredential({
      associatedData: azureCredentialAssociatedData(
        input.workspaceId,
        credential.id,
      ),
      envelope: credential.encryptedPayload,
      masterKey: parseCredentialsMasterKey(getEnv().TOWBAR_CREDENTIALS_KEY),
    }),
  );
  return {
    clientId: credential.clientId,
    id: credential.id,
    payload,
    tenantId: credential.tenantId,
  };
}

function azureCredentialAssociatedData(workspaceId: string, recordId: string) {
  return `${workspaceId}:workspace:azure-credentials:${recordId}`;
}
