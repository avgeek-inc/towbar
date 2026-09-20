import { and, count, desc, eq, gt, isNull, sql } from "drizzle-orm";
import {
  createOpaqueToken,
  hashOpaqueToken,
} from "@workspace/towbar-core/security";
import { isWorkspaceRole, roleActions } from "@workspace/towbar-access";
import {
  authAccounts,
  installationSetup,
  sessions,
  users,
  workspaceMembers,
  workspaces,
} from "@workspace/towbar-database/schema";
import { conflict, forbidden, unauthorized } from "../../http/errors.js";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import {
  createIdentityAuth,
  getIdentityAuth,
  identityProvisioning,
} from "./identity.js";
import { enqueueIdentityEmail } from "../team/email-outbox.js";

export const sessionLifetimeSeconds = 7 * 24 * 60 * 60;
export async function getInitialSetupStatus() {
  const [setup] = await getTowbarDatabase()
    .select({ completedAt: installationSetup.completedAt })
    .from(installationSetup)
    .where(eq(installationSetup.id, 1));
  return { setupRequired: !setup?.completedAt };
}
export async function issueSetupCode() {
  const code = createOpaqueToken();
  await getTowbarDatabase().transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('towbar-initial-setup'))`,
    );
    const [workspace] = await tx.select({ count: count() }).from(workspaces);
    if (workspace?.count)
      throw conflict(
        "Towbar setup has already been completed",
        "SETUP_COMPLETED",
      );
    await tx
      .insert(installationSetup)
      .values({ id: 1, codeHash: hashOpaqueToken(code) })
      .onConflictDoUpdate({
        target: installationSetup.id,
        set: { codeHash: hashOpaqueToken(code) },
      });
  });
  return code;
}
export async function createInitialAdmin(input: {
  teamName: string;
  displayName: string;
  email: string;
  password: string;
  setupCode: string;
}) {
  const email = input.email.trim().toLowerCase();
  await getTowbarDatabase().transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('towbar-initial-setup'))`,
    );
    const [setup] = await tx
      .select()
      .from(installationSetup)
      .where(eq(installationSetup.id, 1))
      .for("update");
    if (setup?.completedAt)
      throw conflict(
        "Towbar setup has already been completed",
        "SETUP_COMPLETED",
      );
    if (!setup?.codeHash || setup.codeHash !== hashOpaqueToken(input.setupCode))
      throw forbidden("Use the setup link issued by the installation command");
    const [workspace] = await tx
      .insert(workspaces)
      .values({ name: input.teamName.trim(), slug: "towbar" })
      .returning({ id: workspaces.id });
    if (!workspace) throw new Error("Unable to create team");
    const auth = createIdentityAuth(tx);
    const result = await identityProvisioning.run(
      { reason: "setup", workspaceId: workspace.id },
      () =>
        auth.api.signUpEmail({
          body: {
            name: input.displayName.trim(),
            email,
            password: input.password,
          },
        }),
    );
    await tx.insert(workspaceMembers).values({
      workspaceId: workspace.id,
      userId: result.user.id,
      role: "admin",
    });
    await tx
      .update(installationSetup)
      .set({
        workspaceId: workspace.id,
        breakGlassUserId: result.user.id,
        completedAt: new Date(),
        codeHash: null,
      })
      .where(eq(installationSetup.id, 1));
  });
  return await getIdentityAuth().api.signInEmail({
    body: { email, password: input.password },
    asResponse: true,
  });
}
export async function authenticatePassword(
  input: { email: string; password: string },
  headers?: Headers,
) {
  const email = input.email.trim().toLowerCase();
  return await getIdentityAuth().api.signInEmail({
    body: { email, password: input.password },
    headers,
    asResponse: true,
  });
}
export async function getUserIdentity(userId: string) {
  const [identity] = await getTowbarDatabase()
    .select({
      passwordSetupRequired: sql<boolean>`not exists (select 1 from ${authAccounts} where ${authAccounts.userId} = ${users.id} and ${authAccounts.providerId} = 'credential' and ${authAccounts.password} is not null)`,
      email: users.email,
      id: users.id,
      name: users.displayName,
      dateTimePreferences: users.dateTimePreferences,
      emailVerified: users.emailVerified,
      mustChangePassword: users.mustChangePassword,
      twoFactorEnabled: users.twoFactorEnabled,
      workspaceRole: workspaceMembers.role,
      workspaceId: workspaces.id,
      teamName: workspaces.name,
    })
    .from(users)
    .innerJoin(workspaceMembers, eq(workspaceMembers.userId, users.id))
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(and(eq(users.id, userId), isNull(users.disabledAt)))
    .limit(1);
  if (!identity || !isWorkspaceRole(identity.workspaceRole)) return null;
  return {
    ...identity,
    capabilities: identity.mustChangePassword
      ? (["personal.manage"] as const)
      : roleActions(identity.workspaceRole),
  };
}
export async function findSession(headers: Headers) {
  const session = await getIdentityAuth().api.getSession({ headers });
  if (!session) return null;
  const user = await getUserIdentity(session.user.id);
  if (!user) return null;
  return { sessionId: session.session.id, user };
}
export async function listUserSessions(userId: string) {
  return await getTowbarDatabase()
    .select({
      id: sessions.id,
      createdAt: sessions.createdAt,
      expiresAt: sessions.expiresAt,
      lastSeenAt: sessions.updatedAt,
      ipAddress: sessions.ipAddress,
      userAgent: sessions.userAgent,
    })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, new Date())))
    .orderBy(desc(sessions.updatedAt));
}
export async function revokeUserSession(input: {
  currentSessionId: string | null;
  sessionId: string;
  userId: string;
}) {
  if (input.currentSessionId === input.sessionId)
    throw unauthorized("Use sign out to revoke the current session");
  await getTowbarDatabase()
    .delete(sessions)
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
    .set({ displayName: input.displayName.trim(), updatedAt: new Date() })
    .where(eq(users.id, input.userId))
    .returning({ email: users.email, id: users.id, name: users.displayName });
  return user;
}
export async function changePassword(input: {
  headers: Headers;
  currentPassword?: string;
  newPassword: string;
  userId: string;
}): Promise<Headers> {
  return await getTowbarDatabase().transaction(async (tx) => {
    const auth = createIdentityAuth(tx);
    const [credential] = await tx
      .select({ password: authAccounts.password })
      .from(authAccounts)
      .where(
        and(
          eq(authAccounts.userId, input.userId),
          eq(authAccounts.providerId, "credential"),
        ),
      )
      .limit(1);
    let responseHeaders = new Headers();
    if (credential?.password) {
      if (!input.currentPassword)
        throw unauthorized("Enter your current password");
      const result = await auth.api.changePassword({
        headers: input.headers,
        body: {
          currentPassword: input.currentPassword,
          newPassword: input.newPassword,
          revokeOtherSessions: true,
        },
        returnHeaders: true,
      });
      responseHeaders = result.headers;
    } else {
      const session = await auth.api.getSession({ headers: input.headers });
      if (!session?.user.emailVerified || session.user.id !== input.userId)
        throw forbidden("Verify your email before choosing a password");
      const result = await auth.api.setPassword({
        headers: input.headers,
        body: { newPassword: input.newPassword },
        returnHeaders: true,
      });
      responseHeaders = result.headers;
    }
    await tx
      .update(users)
      .set({ mustChangePassword: false, updatedAt: new Date() })
      .where(eq(users.id, input.userId));
    const [user] = await tx
      .select()
      .from(users)
      .where(eq(users.id, input.userId));
    if (user)
      await enqueueIdentityEmail(tx, {
        userId: user.id,
        email: user.email,
        name: user.displayName,
        template: "password-changed",
      });
    return responseHeaders;
  });
}
export { resetAdminPassword } from "./operator-recovery.js";
