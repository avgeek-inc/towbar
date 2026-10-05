import { randomUUID } from "node:crypto";

import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { SignJWT, jwtVerify } from "jose";

import {
  integrationInstallations,
  requestNonces,
  sources,
} from "@workspace/towbar-database/schema";

import { getEnv } from "../../env.js";
import { HttpError, conflict, forbidden, notFound } from "../../http/errors.js";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import {
  deleteGitHubInstallation,
  getGitHubInstallation,
  getGitHubRepository,
  listGitHubRepositories,
} from "./client.js";
import { githubPermissionReadiness } from "./permissions.js";
import { getGitHubAppConfiguration } from "./configuration.js";

const connectionSelection = {
  accountLogin: integrationInstallations.principalName,
  accountType: integrationInstallations.principalType,
  id: integrationInstallations.id,
  installationId: integrationInstallations.externalId,
  suspendedAt: integrationInstallations.suspendedAt,
  updatedAt: integrationInstallations.updatedAt,
};

export async function getGitHubConnections(workspaceId: string) {
  return await getTowbarDatabase()
    .select(connectionSelection)
    .from(integrationInstallations)
    .where(
      and(
        eq(integrationInstallations.workspaceId, workspaceId),
        eq(integrationInstallations.provider, "github"),
      ),
    )
    .orderBy(integrationInstallations.principalName);
}

export async function getGitHubConnection(
  workspaceId: string,
  connectionId?: string,
) {
  const connections = await getGitHubConnections(workspaceId);
  if (connectionId) {
    const connection = connections.find((item) => item.id === connectionId);
    if (!connection) throw notFound("GitHub connection");
    return connection;
  }
  if (connections.length > 1)
    throw conflict("Choose a GitHub account for this operation");
  return connections[0] ?? null;
}

export async function getGitHubConnectionStatuses(
  workspaceId: string,
  lookup = getGitHubInstallation,
  repositoryLookup = getGitHubRepository,
) {
  const connections = await getGitHubConnections(workspaceId);
  return Promise.all(
    connections.map(async (connection) => {
      if (connection.suspendedAt)
        return {
          ...connection,
          permissionReadiness: { status: "unavailable" as const },
        };
      try {
        const installation = await lookup(
          connection.installationId,
          workspaceId,
        );
        await getTowbarDatabase()
          .update(integrationInstallations)
          .set({
            principalId: String(installation.account.id),
            principalName: installation.account.login,
            principalType: installation.account.type,
            suspendedAt: installation.suspended_at
              ? new Date(installation.suspended_at)
              : null,
          })
          .where(
            and(
              eq(integrationInstallations.id, connection.id),
              eq(
                integrationInstallations.externalId,
                connection.installationId,
              ),
              isNull(integrationInstallations.suspendedAt),
            ),
          );
        const identityWarnings = await backfillSourceIdentities(
          connection,
          repositoryLookup,
        );
        return {
          ...connection,
          identityWarnings,
          accountLogin: installation.account.login,
          accountType: installation.account.type,
          suspendedAt: installation.suspended_at
            ? new Date(installation.suspended_at)
            : null,
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
    }),
  );
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
  return saveGitHubInstallation(input.workspaceId, installation);
}

export async function saveGitHubInstallation(
  workspaceId: string,
  installation: Awaited<ReturnType<typeof getGitHubInstallation>>,
) {
  return await getTowbarDatabase().transaction(async (transaction) => {
    // The account lock also prevents another workspace from claiming the same installation.
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`github-account:${installation.account.id}`}, 0))`,
    );
    // Serialize callbacks, including reconnection after GitHub assigns a new installation ID.
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`github:${workspaceId}`}, 0))`,
    );
    const [owned] = await transaction
      .select()
      .from(integrationInstallations)
      .where(
        and(
          eq(integrationInstallations.provider, "github"),
          eq(integrationInstallations.externalId, String(installation.id)),
        ),
      );
    if (owned && owned.workspaceId !== workspaceId)
      throw conflict(
        "This GitHub installation is already connected to another workspace",
      );
    const [account] = await transaction
      .select()
      .from(integrationInstallations)
      .where(
        and(
          eq(integrationInstallations.workspaceId, workspaceId),
          eq(integrationInstallations.provider, "github"),
          eq(
            integrationInstallations.principalId,
            String(installation.account.id),
          ),
        ),
      );
    const existing = owned ?? account;
    const values = {
      externalId: String(installation.id),
      principalId: String(installation.account.id),
      principalName: installation.account.login,
      principalType: installation.account.type,
      provider: "github" as const,
      suspendedAt: installation.suspended_at
        ? new Date(installation.suspended_at)
        : null,
      updatedAt: new Date(),
      workspaceId,
    };
    const [saved] = existing
      ? await transaction
          .update(integrationInstallations)
          .set(values)
          .where(eq(integrationInstallations.id, existing.id))
          .returning({ id: integrationInstallations.id })
      : await transaction
          .insert(integrationInstallations)
          .values(values)
          .returning({ id: integrationInstallations.id });
    return saved;
  });
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

async function backfillSourceIdentities(
  connection: { id: string; installationId: string },
  lookup: typeof getGitHubRepository,
) {
  const database = getTowbarDatabase();
  const legacySources = await database
    .select()
    .from(sources)
    .where(
      and(
        eq(sources.integrationInstallationId, connection.id),
        isNull(sources.providerRepositoryId),
        eq(sources.status, "active"),
      ),
    );
  const warnings: string[] = [];
  for (const source of legacySources) {
    try {
      const repository = await lookup({
        installationId: connection.installationId,
        repositoryName: source.repositoryName,
        repositoryOwner: source.repositoryOwner,
      });
      await database
        .update(sources)
        .set({ providerRepositoryId: repository.id })
        .where(
          and(
            eq(sources.id, source.id),
            isNull(sources.providerRepositoryId),
            eq(sources.integrationInstallationId, connection.id),
            eq(sources.repositoryOwner, source.repositoryOwner),
            eq(sources.repositoryName, source.repositoryName),
          ),
        );
    } catch {
      warnings.push(
        `Could not verify ${source.repositoryOwner}/${source.repositoryName}. Restore its access before moving its connection.`,
      );
    }
  }
  return warnings;
}

export async function getWorkspaceGitHubRepositories(
  workspaceId: string,
  connectionId?: string,
  dependencies = {
    listRepositories: listGitHubRepositories,
    getRepository: getGitHubRepository,
  },
) {
  const connections = connectionId
    ? [await getGitHubConnection(workspaceId, connectionId)].filter(
        (item) => item !== null,
      )
    : await getGitHubConnections(workspaceId);
  const results = await Promise.all(
    connections.map(async (connection) => {
      try {
        if (connection.suspendedAt)
          throw conflict("Reconnect this GitHub account");
        const repositories = await dependencies.listRepositories(
          connection.installationId,
        );
        const identityWarnings = await backfillSourceIdentities(
          connection,
          dependencies.getRepository,
        );
        return {
          repositories: repositories.map((repository) => ({
            ...repository,
            connectionId: connection.id,
          })),
          unavailable: null,
          identityWarnings,
        };
      } catch (error) {
        return {
          repositories: [],
          identityWarnings: [],
          unavailable: {
            id: connection.id,
            accountLogin: connection.accountLogin,
            message:
              error instanceof Error
                ? error.message
                : "Could not load repositories",
          },
        };
      }
    }),
  );
  return {
    repositories: results
      .flatMap((result) => result.repositories)
      .sort((a, b) => a.fullName.localeCompare(b.fullName)),
    identityWarnings: results.flatMap((result) => result.identityWarnings),
    unavailableConnections: results.flatMap((result) =>
      result.unavailable ? [result.unavailable] : [],
    ),
  };
}

export async function disconnectGitHub(
  workspaceId: string,
  connectionId?: string,
  uninstall = deleteGitHubInstallation,
) {
  const installation = await getGitHubConnection(workspaceId, connectionId);
  if (!installation) return;
  await getTowbarDatabase().transaction(async (transaction) => {
    const [current] = await transaction
      .select()
      .from(integrationInstallations)
      .where(
        and(
          eq(integrationInstallations.id, installation.id),
          eq(integrationInstallations.workspaceId, workspaceId),
        ),
      )
      .for("update");
    if (!current) throw notFound("GitHub connection");
    if (current.suspendedAt) return;
    try {
      await uninstall(current.externalId);
    } catch (error) {
      if (!(error instanceof HttpError && error.status === 404)) throw error;
    }
    await transaction
      .update(integrationInstallations)
      .set({ suspendedAt: new Date(), updatedAt: new Date() })
      .where(eq(integrationInstallations.id, current.id));
  });
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
        eq(integrationInstallations.provider, "github"),
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
