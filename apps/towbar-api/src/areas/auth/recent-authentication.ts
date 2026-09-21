import { and, eq } from "drizzle-orm";
import {
  authAccounts,
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
      "Confirm your password to continue",
    );
}
export async function reauthenticate(input: {
  userId: string;
  sessionId: string;
  headers: Headers;
  password: string;
  code?: string;
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
  const [account] = await getTowbarDatabase()
    .select({
      password: authAccounts.password,
      twoFactorEnabled: users.twoFactorEnabled,
    })
    .from(authAccounts)
    .innerJoin(users, eq(users.id, authAccounts.userId))
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
  if (account.twoFactorEnabled) {
    if (!input.code)
      throw new HttpError(
        400,
        "TWO_FACTOR_REQUIRED",
        "Enter the code from your authenticator app",
      );
    await auth.api.verifyTOTP({
      headers: input.headers,
      body: { code: input.code },
    });
  }
  await clearPersistentBucket(`reauth:${input.userId}`);
  await getTowbarDatabase()
    .update(sessions)
    .set({ authenticatedAt: new Date() })
    .where(
      and(eq(sessions.id, input.sessionId), eq(sessions.userId, input.userId)),
    );
}
