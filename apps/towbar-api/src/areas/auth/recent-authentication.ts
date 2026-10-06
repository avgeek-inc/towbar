import { and, eq } from "drizzle-orm";
import {
  authAccounts,
  authPasskeys,
  sessions,
  users,
} from "@workspace/towbar-database/schema";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import { HttpError, unauthorized } from "../../http/errors.js";
import { getIdentityAuth } from "./identity.js";
import {
  clearPersistentBucket,
  incrementPersistentBucket,
} from "../../http/rate-limit.js";

export async function requireRecentAuthentication(
  userId: string,
  sessionId: string | null,
) {
  if (!sessionId) throw unauthorized("Sign in to continue");
  const [session] = await getTowbarDatabase()
    .select({ authenticatedAt: sessions.authenticatedAt })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))
    .limit(1);
  if (!session || Date.now() - session.authenticatedAt.getTime() > 10 * 60_000)
    throw new HttpError(
      403,
      "REAUTHENTICATION_REQUIRED",
      "Confirm your identity to continue",
    );
}
export async function reauthenticate(input: {
  userId: string;
  sessionId: string;
  headers: Headers;
  password: string;
}) {
  const bucket = await incrementPersistentBucket(
    `reauth:${input.userId}`,
    new Date(),
    10 * 60_000,
  );
  if (bucket.attempts > 5)
    throw new HttpError(
      429,
      "AUTH_RATE_LIMITED",
      "Too many attempts. Try again later",
      { responseHeaders: { "Retry-After": "600" } },
    );
  await getTowbarDatabase().transaction(async (tx) => {
    const [user] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, input.userId))
      .for("update");
    if (!user) throw unauthorized("Sign in to continue");
    const [passkey] = await tx
      .select({ id: authPasskeys.id })
      .from(authPasskeys)
      .where(eq(authPasskeys.userId, input.userId))
      .limit(1);
    if (passkey)
      throw unauthorized("Use your passkey to confirm your identity");
    const [account] = await tx
      .select({
        password: authAccounts.password,
      })
      .from(authAccounts)
      .where(
        and(
          eq(authAccounts.userId, input.userId),
          eq(authAccounts.providerId, "credential"),
        ),
      )
      .limit(1);
    const auth = getIdentityAuth();
    const authContext = await auth.$context;
    if (
      !account?.password ||
      !(await authContext.password.verify({
        hash: account.password,
        password: input.password,
      }))
    )
      throw unauthorized("Password is incorrect");
    await tx
      .update(sessions)
      .set({ authenticatedAt: new Date() })
      .where(
        and(
          eq(sessions.id, input.sessionId),
          eq(sessions.userId, input.userId),
        ),
      );
  });
  await clearPersistentBucket(`reauth:${input.userId}`);
}
