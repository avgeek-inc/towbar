import { and, count, desc, eq, gt, isNull, ne, sql } from "drizzle-orm";

import {
  createOpaqueToken,
  hashOpaqueToken,
  hashPassword,
} from "@workspace/towbar-core/security";
import {
  passwordCredentials,
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
import {
  createOperatorResetIdempotencyMarker,
  matchesOperatorResetIdempotencyMarker,
} from "./operator-reset-idempotency.js";

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
}) {
  const passwordHash = await runPasswordOperationWithCapacityLimit(() =>
    hashPassword(input.password),
  );
  const database = getTowbarDatabase();
  const userId = await database.transaction(async (transaction) => {
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

    return user.id;
  });
  return await createSessionForUser(userId);
}

export async function authenticatePassword(input: {
  email: string;
  password: string;
}) {
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

  return await createSessionForUser(account.userId);
}

async function createSessionForUser(userId: string) {
  const database = getTowbarDatabase();
  return await database.transaction(async (transaction) => {
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
      .where(and(eq(users.id, userId), isNull(users.disabledAt)))
      .limit(1);
    if (!identity) throw unauthorized("Account is unavailable");

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

export async function applyOwnerPasswordResetFromEnvironment() {
  const env = getEnv();
  if (!env.TOWBAR_OWNER_RESET_EMAIL || !env.TOWBAR_OWNER_RESET_PASSWORD) {
    return { status: "disabled" } as const;
  }
  const email = normalizeEmail(env.TOWBAR_OWNER_RESET_EMAIL);
  const temporaryPassword = env.TOWBAR_OWNER_RESET_PASSWORD;
  const resetMarker = createOperatorResetIdempotencyMarker({
    email,
    internalHmacSecret: env.TOWBAR_INTERNAL_HMAC_SECRET,
    temporaryPassword,
  });
  const passwordHash = await runPasswordOperationWithCapacityLimit(() =>
    hashPassword(temporaryPassword),
  );
  const database = getTowbarDatabase();
  return await database.transaction(async (transaction) => {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtext('towbar-owner-password-reset'))`,
    );
    const [credential] = await transaction
      .select({
        fingerprint: passwordCredentials.operatorResetFingerprint,
        userId: users.id,
      })
      .from(users)
      .innerJoin(passwordCredentials, eq(passwordCredentials.userId, users.id))
      .innerJoin(workspaceMembers, eq(workspaceMembers.userId, users.id))
      .where(
        and(
          eq(users.email, email),
          eq(workspaceMembers.role, "owner"),
          isNull(users.disabledAt),
        ),
      )
      .for("update")
      .limit(1);
    if (!credential) {
      throw new Error(`Towbar owner ${email} was not found`);
    }
    if (
      matchesOperatorResetIdempotencyMarker(resetMarker, credential.fingerprint)
    ) {
      return { email, status: "already-applied" } as const;
    }
    await transaction
      .update(passwordCredentials)
      .set({
        operatorResetFingerprint: resetMarker,
        passwordHash,
        updatedAt: new Date(),
      })
      .where(eq(passwordCredentials.userId, credential.userId));
    await transaction
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(
        and(eq(sessions.userId, credential.userId), isNull(sessions.revokedAt)),
      );
    return { email, status: "applied" } as const;
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

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}
