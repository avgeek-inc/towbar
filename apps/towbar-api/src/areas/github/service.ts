import { randomUUID } from "node:crypto";

import { and, eq, lt } from "drizzle-orm";
import { SignJWT, jwtVerify } from "jose";

import {
  integrationInstallations,
  requestNonces,
} from "@workspace/towbar-database/schema";

import { getEnv } from "../../env.js";
import { conflict, forbidden, notFound } from "../../http/errors.js";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import {
  deleteGitHubInstallation,
  getGitHubInstallation,
  listGitHubRepositories,
} from "./client.js";
import { githubPermissionReadiness } from "./permissions.js";
import { getGitHubAppConfiguration } from "./configuration.js";

export async function getGitHubConnection(workspaceId: string) {
  const [installation] = await getTowbarDatabase()
    .select({
      accountLogin: integrationInstallations.principalName,
      accountType: integrationInstallations.principalType,
      id: integrationInstallations.id,
      installationId: integrationInstallations.externalId,
      suspendedAt: integrationInstallations.suspendedAt,
      updatedAt: integrationInstallations.updatedAt,
    })
    .from(integrationInstallations)
    .where(eq(integrationInstallations.workspaceId, workspaceId))
    .limit(1);
  return installation ?? null;
}

export async function getGitHubConnectionStatus(workspaceId: string) {
  const connection = await getGitHubConnection(workspaceId);
  if (!connection) return null;
  if (connection.suspendedAt) {
    return {
      ...connection,
      permissionReadiness: { status: "unavailable" as const },
    };
  }
  try {
    const installation = await getGitHubInstallation(
      connection.installationId,
      workspaceId,
    );
    return {
      ...connection,
      permissionReadiness: {
        ...githubPermissionReadiness(installation.permissions),
        status: "available" as const,
      },
    };
  } catch {
    return {
      ...connection,
      permissionReadiness: { status: "unavailable" as const },
    };
  }
}

export async function createInstallationUrl(input: {
  userId: string;
  workspaceId: string;
}) {
  const github = await getGitHubAppConfiguration(input.workspaceId);
  const state = await new SignJWT({
    userId: input.userId,
    workspaceId: input.workspaceId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setJti(randomUUID())
    .setExpirationTime("10m")
    .setAudience("towbar-github-installation")
    .setIssuer("towbar-api")
    .sign(new TextEncoder().encode(getEnv().TOWBAR_INTERNAL_HMAC_SECRET));
  const url = new URL(
    `https://github.com/apps/${github.appSlug}/installations/new`,
  );
  url.searchParams.set("state", state);
  return url.toString();
}

export async function completeInstallation(input: {
  installationId: string;
  state: string;
  userId: string;
  workspaceId: string;
}) {
  const { payload } = await jwtVerify(
    input.state,
    new TextEncoder().encode(getEnv().TOWBAR_INTERNAL_HMAC_SECRET),
    {
      audience: "towbar-github-installation",
      issuer: "towbar-api",
    },
  );
  if (
    payload.userId !== input.userId ||
    payload.workspaceId !== input.workspaceId
  ) {
    throw forbidden("GitHub installation state does not match this session");
  }
  if (!payload.jti || !payload.exp) {
    throw forbidden("GitHub installation state is incomplete");
  }
  const installation = await getGitHubInstallation(
    input.installationId,
    input.workspaceId,
  );
  // Consume only after GitHub confirms the installation belongs to this App.
  // A transient GitHub failure can then retry the same signed callback safely.
  await consumeInstallationState(payload.jti, payload.exp);
  const database = getTowbarDatabase();
  const [existing] = await database
    .select({ id: integrationInstallations.id })
    .from(integrationInstallations)
    .where(eq(integrationInstallations.workspaceId, input.workspaceId))
    .limit(1);
  const values = {
    externalId: String(installation.id),
    principalName: installation.account.login,
    principalType: installation.account.type,
    provider: "github" as const,
    suspendedAt: installation.suspended_at
      ? new Date(installation.suspended_at)
      : null,
    updatedAt: new Date(),
    workspaceId: input.workspaceId,
  };
  const [saved] = existing
    ? await database
        .update(integrationInstallations)
        .set(values)
        .where(eq(integrationInstallations.id, existing.id))
        .returning({ id: integrationInstallations.id })
    : await database
        .insert(integrationInstallations)
        .values(values)
        .returning({ id: integrationInstallations.id });
  return saved;
}

async function consumeInstallationState(nonce: string, expiresAt: number) {
  const database = getTowbarDatabase();
  const created = await database
    .insert(requestNonces)
    .values({
      expiresAt: new Date(expiresAt * 1_000),
      nonce,
      scope: "github-installation",
    })
    .onConflictDoNothing()
    .returning({ nonce: requestNonces.nonce });
  if (created.length === 0) {
    throw forbidden("GitHub installation state was already used");
  }
  await database
    .delete(requestNonces)
    .where(
      and(
        eq(requestNonces.scope, "github-installation"),
        lt(requestNonces.expiresAt, new Date()),
      ),
    );
}

export async function getWorkspaceGitHubRepositories(workspaceId: string) {
  const installation = await getGitHubConnection(workspaceId);
  if (!installation) throw notFound("GitHub installation");
  if (installation.suspendedAt) {
    throw conflict("Reconnect the GitHub App before listing repositories");
  }
  return await listGitHubRepositories(installation.installationId);
}

export async function disconnectGitHub(workspaceId: string) {
  const installation = await getGitHubConnection(workspaceId);
  if (!installation) return;
  await deleteGitHubInstallation(installation.installationId);
  await getTowbarDatabase()
    .update(integrationInstallations)
    .set({ suspendedAt: new Date(), updatedAt: new Date() })
    .where(eq(integrationInstallations.workspaceId, workspaceId));
}

export async function getGitHubInstallationForSource(input: {
  installationId: string;
  workspaceId: string;
}) {
  const [installation] = await getTowbarDatabase()
    .select()
    .from(integrationInstallations)
    .where(
      and(
        eq(integrationInstallations.id, input.installationId),
        eq(integrationInstallations.workspaceId, input.workspaceId),
      ),
    )
    .limit(1);
  if (!installation) throw notFound("GitHub installation");
  if (installation.suspendedAt) {
    throw conflict(
      "Reconnect the GitHub App before synchronizing repositories",
    );
  }
  return installation;
}
