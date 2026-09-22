import { createSign } from "node:crypto";

import {
  gcsConnectionConfigurationSchema,
  gcsConnectionCredentialsSchema,
} from "@workspace/towbar-core";
import { z } from "zod";

import {
  HttpError,
  badRequest,
  notFound,
  serviceUnavailable,
} from "../../http/errors.js";
import { getRuntimeIntegration } from "../../infrastructure/runtime-integrations.js";

const gcpServiceAccountKeySchema = z
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

type GcpServiceAccountKey = z.infer<typeof gcpServiceAccountKeySchema>;

function parseGcpServiceAccountJson(raw: string): GcpServiceAccountKey {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw badRequest("Invalid JSON in service account key");
  }
  const result = gcpServiceAccountKeySchema.safeParse(parsed);
  if (!result.success)
    throw badRequest(
      "Service account key must be a valid Google Cloud service account JSON key",
    );
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
  const body = new URLSearchParams({
    assertion: `${signatureInput}.${signature}`,
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
  });
  try {
    const response = await fetch(
      payload.token_uri ?? "https://oauth2.googleapis.com/token",
      {
        body: body.toString(),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        method: "POST",
      },
    );
    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw serviceUnavailable("Google Cloud rejected these credentials", {
        cause: new Error(errorText || `HTTP ${response.status}`),
      });
    }
    const data = (await response.json()) as { access_token?: string };
    if (!data.access_token)
      throw serviceUnavailable("Google Cloud did not return an access token");
    return data.access_token;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw serviceUnavailable(
      "Could not connect to Google Cloud auth endpoint",
      { cause: error },
    );
  }
}

function runtimeCredential() {
  const connection = getRuntimeIntegration("gcs");
  if (!connection || connection.provider !== "gcs") return null;
  const configuration = gcsConnectionConfigurationSchema.parse(
    connection.configuration,
  );
  const credentials = gcsConnectionCredentialsSchema.parse(
    connection.credentials,
  );
  const payload = parseGcpServiceAccountJson(credentials.serviceAccountJson);
  return { configuration, payload };
}

export function hasGcpCredentials(_workspaceId: string) {
  return Promise.resolve(Boolean(runtimeCredential()));
}

export function getDecryptedGcpCredential(input: { workspaceId: string }) {
  return Promise.resolve().then(() => {
    void input;
    const credential = runtimeCredential();
    if (!credential) throw notFound("Google Cloud credentials");
    return {
      id: "environment",
      payload: credential.payload,
      projectId: credential.configuration.projectId,
    };
  });
}
