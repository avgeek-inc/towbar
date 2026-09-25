import { and, eq, isNull } from "drizzle-orm";
import {
  type IntegrationProvider,
  type IntegrationPurpose,
  type IntegrationScope,
  type IntegrationTarget,
  type ProviderConnection,
  credentialHint,
  decryptCredential,
  encryptCredential,
  integrationCredentialAssociatedData,
  integrationScopeAllows,
  parseCredentialsMasterKey,
  parseProviderConnection,
} from "@workspace/towbar-core";
import { integrationAuthorizations } from "@workspace/towbar-database/schema";
import { z } from "zod";

import { getEnv } from "../../env.js";
import {
  conflict,
  forbidden,
  notFound,
  serviceUnavailable,
} from "../../http/errors.js";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import { integrationFetch } from "../../infrastructure/outbound-network.js";
import {
  getRuntimeIntegration,
  requireGitLabRuntimeConfiguration,
} from "../../infrastructure/runtime-integrations.js";

type Connection = typeof integrationAuthorizations.$inferSelect;

const purposeByProvider: Record<IntegrationProvider, IntegrationPurpose> = {
  aws: "backup",
  cloudflare: "ingress",
  doppler: "secret",
  gcs: "backup",
  github: "source",
  gitlab: "source",
  infisical: "secret",
  r2: "backup",
  registry: "image",
  s3: "backup",
};

const gitLabGrantSchema = z
  .object({
    refreshToken: z.string().min(1).max(16_384),
    token: z.string().min(1).max(16_384),
    tokenExpiresAt: z.string().datetime(),
  })
  .strict();

const gitLabRefreshSchema = z.object({
  access_token: z.string().min(1).max(16_384),
  created_at: z.number().int().nonnegative().optional(),
  expires_in: z.number().int().positive().max(31_536_000),
  refresh_token: z.string().min(1).max(16_384),
});

export function encryptIntegrationCredentials(
  workspaceId: string,
  id: string,
  provider: IntegrationProvider,
  credentials: unknown,
) {
  return encryptCredential({
    associatedData: integrationCredentialAssociatedData(
      workspaceId,
      id,
      provider,
    ),
    masterKey: parseCredentialsMasterKey(getEnv().TOWBAR_CREDENTIALS_KEY),
    value: credentials,
  });
}

function decryptIntegration(
  connection: Connection,
): Extract<ProviderConnection, { provider: "gitlab" }> {
  if (connection.provider !== "gitlab")
    throw conflict("Only dynamic GitLab authorizations are stored");
  if (connection.disconnectedAt || !connection.encryptedPayload)
    throw conflict("This integration is disconnected");
  const grant = gitLabGrantSchema.parse(
    decryptCredential({
      associatedData: integrationCredentialAssociatedData(
        connection.workspaceId,
        connection.id,
        connection.provider,
      ),
      masterKey: parseCredentialsMasterKey(getEnv().TOWBAR_CREDENTIALS_KEY),
      envelope: connection.encryptedPayload,
    }),
  );
  const runtime = requireGitLabRuntimeConfiguration();
  return parseProviderConnection({
    provider: "gitlab",
    configuration: {
      allowPrivateNetwork: runtime.allowPrivateNetwork,
      baseUrl: runtime.baseUrl,
    },
    credentials: {
      ...grant,
      oauthClientId: runtime.oauthClientId,
      oauthClientSecret: runtime.oauthClientSecret,
      oauthRedirectUri: runtime.oauthRedirectUri,
      webhookSecret: runtime.webhookSecret,
    },
  }) as Extract<ProviderConnection, { provider: "gitlab" }>;
}

export async function resolveIntegration(input: {
  workspaceId: string;
  slug: string;
  target: IntegrationTarget;
  providers: readonly IntegrationProvider[];
  expectedRevision?: number;
}) {
  const runtime = runtimeResolution(
    input.workspaceId,
    input.slug,
    input.providers,
  );
  if (runtime) return runtime;
  const [connection] = await getTowbarDatabase()
    .select()
    .from(integrationAuthorizations)
    .where(
      and(
        eq(integrationAuthorizations.workspaceId, input.workspaceId),
        eq(integrationAuthorizations.slug, input.slug),
        isNull(integrationAuthorizations.disconnectedAt),
      ),
    )
    .limit(1);
  if (!connection) throw notFound("Integration");
  return resolveStoredConnection(connection, input);
}

export async function resolveIntegrationById(input: {
  workspaceId: string;
  id: string;
  target: IntegrationTarget;
  providers: readonly IntegrationProvider[];
  expectedRevision?: number;
}) {
  if (input.id.startsWith("environment:")) {
    const runtime = runtimeResolution(
      input.workspaceId,
      input.id.slice("environment:".length),
      input.providers,
    );
    if (!runtime) throw notFound("Integration");
    return runtime;
  }
  const [connection] = await getTowbarDatabase()
    .select()
    .from(integrationAuthorizations)
    .where(
      and(
        eq(integrationAuthorizations.workspaceId, input.workspaceId),
        eq(integrationAuthorizations.id, input.id),
        isNull(integrationAuthorizations.disconnectedAt),
      ),
    )
    .limit(1);
  if (!connection) throw notFound("Integration");
  return resolveStoredConnection(connection, input);
}

export async function resolveGitLabWebhookConnection(id: string) {
  const [connection] = await getTowbarDatabase()
    .select()
    .from(integrationAuthorizations)
    .where(
      and(
        eq(integrationAuthorizations.id, id),
        eq(integrationAuthorizations.provider, "gitlab"),
        isNull(integrationAuthorizations.disconnectedAt),
      ),
    )
    .limit(1);
  if (!connection) throw notFound("GitLab webhook connection");
  return { connection, connectionInput: decryptIntegration(connection) };
}

async function resolveStoredConnection(
  connection: Connection,
  input: {
    target: IntegrationTarget;
    providers: readonly IntegrationProvider[];
    expectedRevision?: number;
  },
) {
  if (!input.providers.includes(connection.provider))
    throw conflict("This integration uses an incompatible provider");
  if (
    input.expectedRevision !== undefined &&
    connection.revision !== input.expectedRevision
  )
    throw conflict("The integration changed after this operation was queued");
  if (!integrationScopeAllows(connection.scopes, input.target))
    throw forbidden("This integration is not enabled for this operation");
  return refreshGitLabCredentials(connection, decryptIntegration(connection));
}

async function refreshGitLabCredentials(
  connection: Connection,
  connectionInput: Extract<ProviderConnection, { provider: "gitlab" }>,
) {
  const expiresAt = Date.parse(
    connectionInput.credentials.tokenExpiresAt ?? "",
  );
  if (Number.isFinite(expiresAt) && expiresAt > Date.now() + 5 * 60_000)
    return { connection, connectionInput };
  const runtime = requireGitLabRuntimeConfiguration();
  const response = await integrationFetch(
    new URL("/oauth/token", runtime.baseUrl).toString(),
    {
      allowPrivateNetwork: runtime.allowPrivateNetwork,
      body: new URLSearchParams({
        client_id: runtime.oauthClientId,
        client_secret: runtime.oauthClientSecret,
        grant_type: "refresh_token",
        redirect_uri: runtime.oauthRedirectUri,
        refresh_token: connectionInput.credentials.refreshToken!,
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      method: "POST",
    },
  );
  if (!response.ok) {
    await getTowbarDatabase()
      .update(integrationAuthorizations)
      .set({
        verificationMessage:
          "GitLab OAuth refresh was rejected. Reconnect GitLab.",
        verificationStatus: "failed",
        verifiedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(integrationAuthorizations.id, connection.id));
    throw serviceUnavailable("GitLab rejected the OAuth refresh token");
  }
  const refreshed = gitLabRefreshSchema.parse(await response.json());
  const issuedAt =
    (refreshed.created_at ?? Math.floor(Date.now() / 1_000)) * 1_000;
  const grant = {
    refreshToken: refreshed.refresh_token,
    token: refreshed.access_token,
    tokenExpiresAt: new Date(
      issuedAt + refreshed.expires_in * 1_000,
    ).toISOString(),
  };
  const [updated] = await getTowbarDatabase()
    .update(integrationAuthorizations)
    .set({
      credentialHint: credentialHint("gitlab", {
        ...connectionInput.credentials,
        ...grant,
      }),
      encryptedPayload: encryptIntegrationCredentials(
        connection.workspaceId,
        connection.id,
        "gitlab",
        grant,
      ),
      updatedAt: new Date(),
      verificationMessage: "GitLab OAuth token refreshed",
      verificationStatus: "verified",
      verifiedAt: new Date(),
    })
    .where(
      and(
        eq(integrationAuthorizations.id, connection.id),
        eq(integrationAuthorizations.updatedAt, connection.updatedAt),
        isNull(integrationAuthorizations.disconnectedAt),
      ),
    )
    .returning();
  if (!updated)
    throw conflict("The GitLab authorization changed. Retry the request.");
  return { connection: updated, connectionInput: decryptIntegration(updated) };
}

function runtimeResolution(
  workspaceId: string,
  slug: string,
  providers: readonly IntegrationProvider[],
) {
  const provider = providers.find((candidate) => candidate === slug);
  if (!provider || provider === "gitlab") return null;
  const connectionInput = getRuntimeIntegration(provider);
  if (!connectionInput) return null;
  const now = new Date(0);
  const connection: Connection = {
    createdAt: now,
    credentialHint: null,
    description: "Configured by the Towbar runtime environment",
    disconnectedAt: null,
    encryptedPayload: null,
    id: `environment:${provider}`,
    name: provider,
    provider,
    revision: 1,
    scopes: [
      {
        kind: "workspace",
        purpose: purposeByProvider[provider],
      } as IntegrationScope,
    ],
    slug: provider,
    updatedAt: now,
    verificationMessage: "Configured by the Towbar runtime environment",
    verificationStatus: "verified",
    verifiedAt: null,
    workspaceId,
  };
  return { connection, connectionInput };
}
