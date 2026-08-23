import { and, count, desc, eq, gt, isNull, ne, sql } from "drizzle-orm";

import {
  createOpaqueToken,
  hashOpaqueToken,
  hashPassword,
} from "@workspace/towbar-core/security";
import {
  authCodes,
  passwordCredentials,
  passwordResetTokens,
  sessions,
  users,
  workspaceMembers,
  workspaces,
} from "@workspace/towbar-database/schema";

import { getEnv } from "../../env.js";
import { conflict, unauthorized } from "../../http/errors.js";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import {
  runPasswordOperationWithCapacityLimit,
  verifyPasswordWithCapacityLimit,
} from "./password-verification.js";

const authorizationCodeLifetimeMs = 5 * 60 * 1_000;
export const sessionLifetimeSeconds = 7 * 24 * 60 * 60;
const unknownAccountPasswordHash =
  "$towbar$argon2id$v=1$m=65536,t=3,p=4$pOGJD7pP_rgy7saYUKKf2Q$58GDGqYgHVdoGe31MHyOUNV9wIFp86NJw0tUqQPkgGM";

export async function getInitialSetupStatus() {
  const [result] = await getTowbarDatabase()
    .select({ value: count() })
    .from(users);
  return { setupRequired: (result?.value ?? 0) === 0 };
}

export async function createInitialOwner(input: {
  displayName: string;
  email: string;
  password: string;
  redirectUri: string;
}) {
  const redirectUri = validateRedirectUri(input.redirectUri);
  const passwordHash = await runPasswordOperationWithCapacityLimit(() =>
    hashPassword(input.password),
  );
  const database = getTowbarDatabase();
  return await database.transaction(async (transaction) => {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtext('towbar-initial-owner'))`,
    );
    const [existing] = await transaction.select({ value: count() }).from(users);
    if ((existing?.value ?? 0) > 0) {
      throw conflict(
        "Towbar setup has already been completed",
        "SETUP_COMPLETED",
      );
    }

    const [user] = await transaction
      .insert(users)
      .values({
        displayName: input.displayName.trim(),
        email: normalizeEmail(input.email),
      })
      .returning({ id: users.id });
    if (!user) throw new Error("Unable to create the initial owner");

    const [workspace] = await transaction
      .insert(workspaces)
      .values({ name: "Towbar", slug: "towbar" })
      .returning({ id: workspaces.id });
    if (!workspace) throw new Error("Unable to initialize Towbar");

    await transaction.insert(passwordCredentials).values({
      passwordHash,
      userId: user.id,
    });
    await transaction.insert(workspaceMembers).values({
      role: "owner",
      userId: user.id,
      workspaceId: workspace.id,
    });

    const authorizationCode = createOpaqueToken();
    await transaction.insert(authCodes).values({
      codeHash: hashOpaqueToken(authorizationCode),
      expiresAt: new Date(Date.now() + authorizationCodeLifetimeMs),
      redirectUri,
      userId: user.id,
    });
    return { authorizationCode, redirectUri };
  });
}

export async function authenticatePassword(input: {
  email: string;
  password: string;
  redirectUri: string;
}) {
  const redirectUri = validateRedirectUri(input.redirectUri);
  const database = getTowbarDatabase();
  const [account] = await database
    .select({
      disabledAt: users.disabledAt,
      passwordHash: passwordCredentials.passwordHash,
      userId: users.id,
    })
    .from(users)
    .innerJoin(passwordCredentials, eq(passwordCredentials.userId, users.id))
    .where(eq(users.email, normalizeEmail(input.email)))
    .limit(1);
  const passwordMatches = await verifyPasswordWithCapacityLimit(
    input.password,
    account?.passwordHash ?? unknownAccountPasswordHash,
  );
  if (!account || account.disabledAt || !passwordMatches) {
    throw unauthorized("Email or password is incorrect");
  }

  const authorizationCode = createOpaqueToken();
  await database.insert(authCodes).values({
    codeHash: hashOpaqueToken(authorizationCode),
    expiresAt: new Date(Date.now() + authorizationCodeLifetimeMs),
    redirectUri,
    userId: account.userId,
  });
  return { authorizationCode, redirectUri };
}

export async function exchangeAuthorizationCode(input: {
  authorizationCode: string;
  redirectUri: string;
}) {
  const redirectUri = validateRedirectUri(input.redirectUri);
  const database = getTowbarDatabase();
  return await database.transaction(async (transaction) => {
    const [code] = await transaction
      .select({
        id: authCodes.id,
        userId: authCodes.userId,
      })
      .from(authCodes)
      .where(
        and(
          eq(authCodes.codeHash, hashOpaqueToken(input.authorizationCode)),
          eq(authCodes.redirectUri, redirectUri),
          isNull(authCodes.consumedAt),
          gt(authCodes.expiresAt, new Date()),
        ),
      )
      .for("update")
      .limit(1);
    if (!code) throw unauthorized("Authorization code is invalid or expired");

    const [identity] = await transaction
      .select({
        email: users.email,
        name: users.displayName,
        role: workspaceMembers.role,
        userId: users.id,
        workspaceId: workspaces.id,
      })
      .from(users)
      .innerJoin(workspaceMembers, eq(workspaceMembers.userId, users.id))
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(and(eq(users.id, code.userId), isNull(users.disabledAt)))
      .limit(1);
    if (!identity) throw unauthorized("Account is unavailable");

    await transaction
      .update(authCodes)
      .set({ consumedAt: new Date() })
      .where(eq(authCodes.id, code.id));

    const sessionToken = createOpaqueToken();
    const [session] = await transaction
      .insert(sessions)
      .values({
        expiresAt: new Date(Date.now() + sessionLifetimeSeconds * 1_000),
        tokenHash: hashOpaqueToken(sessionToken),
        userId: identity.userId,
      })
      .returning({ id: sessions.id });
    if (!session) throw new Error("Unable to create Towbar session");

    return {
      sessionId: session.id,
      sessionToken,
      user: {
        email: identity.email,
        id: identity.userId,
        name: identity.name,
        workspaceId: identity.workspaceId,
        workspaceRole: identity.role,
      },
    };
  });
}

export async function findSession(sessionToken: string) {
  const database = getTowbarDatabase();
  const [identity] = await database
    .select({
      email: users.email,
      name: users.displayName,
      role: workspaceMembers.role,
      sessionId: sessions.id,
      userId: users.id,
      workspaceId: workspaces.id,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(workspaceMembers, eq(workspaceMembers.userId, users.id))
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(
      and(
        eq(sessions.tokenHash, hashOpaqueToken(sessionToken)),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
        isNull(users.disabledAt),
      ),
    )
    .limit(1);
  if (!identity) return null;

  await database
    .update(sessions)
    .set({ lastSeenAt: new Date() })
    .where(eq(sessions.id, identity.sessionId));
  return {
    sessionId: identity.sessionId,
    user: {
      email: identity.email,
      id: identity.userId,
      name: identity.name,
      workspaceId: identity.workspaceId,
      workspaceRole: identity.role,
    },
  };
}

export async function revokeSession(sessionId: string) {
  await getTowbarDatabase()
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(eq(sessions.id, sessionId));
}

export async function listUserSessions(userId: string) {
  return await getTowbarDatabase()
    .select({
      createdAt: sessions.createdAt,
      expiresAt: sessions.expiresAt,
      id: sessions.id,
      lastSeenAt: sessions.lastSeenAt,
      revokedAt: sessions.revokedAt,
    })
    .from(sessions)
    .where(eq(sessions.userId, userId))
    .orderBy(desc(sessions.lastSeenAt));
}

export async function revokeUserSession(input: {
  currentSessionId: string;
  sessionId: string;
  userId: string;
}) {
  if (input.currentSessionId === input.sessionId) {
    throw unauthorized("Use sign out to revoke the current session");
  }
  await getTowbarDatabase()
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(
      and(eq(sessions.id, input.sessionId), eq(sessions.userId, input.userId)),
    );
}

export async function updateProfile(input: {
  displayName: string;
  userId: string;
}) {
  const [user] = await getTowbarDatabase()
    .update(users)
    .set({ displayName: input.displayName, updatedAt: new Date() })
    .where(eq(users.id, input.userId))
    .returning({
      email: users.email,
      id: users.id,
      name: users.displayName,
    });
  return user;
}

export async function changePassword(input: {
  currentPassword: string;
  currentSessionId: string;
  newPassword: string;
  userId: string;
}) {
  const [credential] = await getTowbarDatabase()
    .select({ passwordHash: passwordCredentials.passwordHash })
    .from(passwordCredentials)
    .where(eq(passwordCredentials.userId, input.userId))
    .limit(1);
  if (
    !credential ||
    !(await verifyPasswordWithCapacityLimit(
      input.currentPassword,
      credential.passwordHash,
    ))
  ) {
    throw unauthorized("Current password is incorrect");
  }
  const passwordHash = await runPasswordOperationWithCapacityLimit(() =>
    hashPassword(input.newPassword),
  );
  await getTowbarDatabase().transaction(async (transaction) => {
    await transaction
      .update(passwordCredentials)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(passwordCredentials.userId, input.userId));
    await transaction
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(sessions.userId, input.userId),
          ne(sessions.id, input.currentSessionId),
          isNull(sessions.revokedAt),
        ),
      );
  });
}

export async function resetPassword(input: {
  newPassword: string;
  token: string;
}) {
  const passwordHash = await hashPassword(input.newPassword);
  const database = getTowbarDatabase();
  await database.transaction(async (transaction) => {
    const [reset] = await transaction
      .select({
        id: passwordResetTokens.id,
        userId: passwordResetTokens.userId,
      })
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.tokenHash, hashOpaqueToken(input.token)),
          isNull(passwordResetTokens.consumedAt),
          gt(passwordResetTokens.expiresAt, new Date()),
        ),
      )
      .for("update")
      .limit(1);
    if (!reset) throw unauthorized("Recovery token is invalid or expired");
    await transaction
      .update(passwordCredentials)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(passwordCredentials.userId, reset.userId));
    await transaction
      .update(passwordResetTokens)
      .set({ consumedAt: new Date() })
      .where(eq(passwordResetTokens.id, reset.id));
    await transaction
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(eq(sessions.userId, reset.userId));
  });
}

export async function revokeSessionByToken(userId: string, token: string) {
  await getTowbarDatabase()
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(sessions.userId, userId),
        eq(sessions.tokenHash, hashOpaqueToken(token)),
      ),
    );
}

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function validateRedirectUri(value: string) {
  const redirect = new URL(value);
  if (redirect.origin !== new URL(getEnv().TOWBAR_APP_BASE_URL).origin) {
    throw unauthorized("Redirect URI is not allowed");
  }
  return redirect.toString();
}
