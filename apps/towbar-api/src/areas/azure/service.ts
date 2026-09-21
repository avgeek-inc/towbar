import {
  azureBlobConnectionConfigurationSchema,
  azureBlobConnectionCredentialsSchema,
} from "@workspace/towbar-core";
import type { z } from "zod";

import { HttpError, notFound, serviceUnavailable } from "../../http/errors.js";
import { getRuntimeIntegration } from "../../infrastructure/runtime-integrations.js";

export const azureCredentialPayloadSchema =
  azureBlobConnectionCredentialsSchema;
export type AzureCredentialPayload = z.infer<
  typeof azureCredentialPayloadSchema
>;

function runtimeCredential() {
  const connection = getRuntimeIntegration("azureBlob");
  if (!connection || connection.provider !== "azureBlob") return null;
  return {
    configuration: azureBlobConnectionConfigurationSchema.parse(
      connection.configuration,
    ),
    payload: azureCredentialPayloadSchema.parse(connection.credentials),
  };
}

export function getAzureCredentialMetadata(_workspaceId: string) {
  const credential = runtimeCredential();
  if (!credential) return Promise.resolve(null);
  return Promise.resolve({
    clientId: credential.payload.clientId,
    clientSecretSuffix: credential.payload.clientSecret.slice(-4),
    lastVerifiedAt: null,
    source: "environment" as const,
    status: "verified" as const,
    tenantId: credential.payload.tenantId,
    verificationMessage: "Configured by the Towbar runtime environment",
  });
}

export function hasAzureCredentials(_workspaceId: string) {
  return Promise.resolve(Boolean(runtimeCredential()));
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
    if (!data.access_token)
      throw serviceUnavailable("Azure did not return an access token");
    return data.access_token;
  } catch (error) {
    if (error instanceof HttpError) throw error;
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
  return { clientId: payload.clientId, tenantId: payload.tenantId };
}

export function getDecryptedAzureCredential(input: { workspaceId: string }) {
  return Promise.resolve().then(() => {
    void input;
    const credential = runtimeCredential();
    if (!credential) throw notFound("Azure credentials");
    return {
      clientId: credential.payload.clientId,
      id: "environment",
      payload: credential.payload,
      storageAccount: credential.configuration.storageAccount,
      tenantId: credential.payload.tenantId,
    };
  });
}
