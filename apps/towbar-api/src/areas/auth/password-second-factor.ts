import { type BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { deleteSessionCookie, expireCookie } from "better-auth/cookies";
import { generateRandomString } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { authPasskeys, users } from "@workspace/towbar-database/schema";
import type { AuthDatabase } from "../../infrastructure/database.js";

type AuthContext = Parameters<typeof expireCookie>[0];
const maxAge = 600;
const bindingPrefix = "towbar-passkey-factor:";
const factorCookie = (ctx: AuthContext) =>
  ctx.context.createAuthCookie("two_factor", { maxAge });

async function pendingPassword(ctx: AuthContext, database: AuthDatabase) {
  const identifier = await ctx.getSignedCookie(
    factorCookie(ctx).name,
    ctx.context.secret,
  );
  const pending = identifier
    ? await ctx.context.internalAdapter.findVerificationValue(identifier)
    : null;
  if (!pending || pending.expiresAt <= new Date())
    throw new APIError("UNAUTHORIZED", {
      message: "Sign in with your email and password before using a passkey.",
    });
  const [user] = await database
    .select()
    .from(users)
    .where(eq(users.id, pending.value));
  if (!user || user.disabledAt)
    throw new APIError("UNAUTHORIZED", { message: "Sign in to continue." });
  return pending;
}

// Share Better Auth's one-use challenge with TOTP and recovery codes, so only
// one second-factor method can complete a given password sign-in.
export function passwordSecondFactor(database: AuthDatabase): BetterAuthPlugin {
  return {
    id: "towbar-password-second-factor",
    hooks: {
      before: [
        {
          matcher: ({ path }) =>
            path === "/passkey/generate-authenticate-options" ||
            path === "/passkey/verify-authentication",
          handler: createAuthMiddleware(async (ctx) => {
            await pendingPassword(ctx, database);
          }),
        },
      ],
      after: [
        {
          matcher: ({ path }) => path === "/sign-in/email",
          handler: createAuthMiddleware(async (ctx) => {
            const session = ctx.context.newSession;
            if (!session) return;
            const keys = await database
              .select({ id: authPasskeys.id })
              .from(authPasskeys)
              .where(eq(authPasskeys.userId, session.user.id))
              .limit(1);
            const methods: Array<"totp" | "passkey"> = [];
            if (session.user.twoFactorEnabled) methods.push("totp");
            if (keys.length) methods.push("passkey");
            if (!methods.length) return;

            deleteSessionCookie(ctx, true);
            await ctx.context.internalAdapter.deleteSession(
              session.session.token,
            );
            ctx.context.setNewSession(null);
            const cookie = factorCookie(ctx);
            const previous = await ctx.getSignedCookie(
              cookie.name,
              ctx.context.secret,
            );
            if (previous)
              await ctx.context.internalAdapter.deleteVerificationByIdentifier(
                previous,
              );
            const identifier = `2fa-${generateRandomString(32)}`;
            const expiresAt = new Date(Date.now() + maxAge * 1000);
            await ctx.context.internalAdapter.createVerificationValue({
              identifier,
              value: session.user.id,
              expiresAt,
            });
            await ctx.context.internalAdapter.createVerificationValue({
              identifier: `2fa-attempts-${identifier}`,
              value: "0",
              expiresAt,
            });
            await ctx.setSignedCookie(
              cookie.name,
              identifier,
              ctx.context.secret,
              cookie.attributes,
            );
            return ctx.json({
              twoFactorRedirect: true,
              twoFactorMethods: methods,
            });
          }),
        },
        {
          matcher: ({ path }) =>
            path === "/passkey/generate-authenticate-options",
          handler: createAuthMiddleware(async (ctx) => {
            const result = ctx.context.returned;
            if (
              !result ||
              typeof result !== "object" ||
              !("challenge" in result) ||
              typeof result.challenge !== "string"
            )
              return;
            const pending = await pendingPassword(ctx, database);
            const keys = await database
              .select({ id: authPasskeys.credentialID })
              .from(authPasskeys)
              .where(eq(authPasskeys.userId, pending.value));
            if (!keys.length)
              throw new APIError("BAD_REQUEST", {
                message: "No passkey is available for this account.",
              });
            await ctx.context.internalAdapter.createVerificationValue({
              identifier: bindingPrefix + result.challenge,
              value: pending.identifier,
              expiresAt: pending.expiresAt,
            });
            return ctx.json({
              ...result,
              userVerification: "required",
              allowCredentials: keys.map(({ id }) => ({
                id,
                type: "public-key",
              })),
            });
          }),
        },
      ],
    },
  };
}

export async function completePasskeySecondFactor(
  ctx: AuthContext,
  database: AuthDatabase,
  credential: { id: string; response: { clientDataJSON: string } },
) {
  const pending = await pendingPassword(ctx, database);
  const [key] = await database
    .select({ userId: authPasskeys.userId })
    .from(authPasskeys)
    .where(eq(authPasskeys.credentialID, credential.id));
  if (key?.userId !== pending.value)
    throw new APIError("UNAUTHORIZED", {
      message: "Use a passkey belonging to the account you signed in with.",
    });
  // The WebAuthn plugin has already verified the signature and client data.
  const clientData = JSON.parse(
    Buffer.from(credential.response.clientDataJSON, "base64url").toString(
      "utf8",
    ),
  ) as { challenge: string };
  const binding = await ctx.context.internalAdapter.consumeVerificationValue(
    bindingPrefix + clientData.challenge,
  );
  if (!binding || binding.value !== pending.identifier)
    throw new APIError("UNAUTHORIZED", {
      message: "This passkey request has expired. Try again.",
    });
  const consumed = await ctx.context.internalAdapter.consumeVerificationValue(
    pending.identifier,
  );
  if (!consumed || consumed.value !== key.userId)
    throw new APIError("UNAUTHORIZED", {
      message: "This sign-in has expired. Sign in again.",
    });
  await ctx.context.internalAdapter.deleteVerificationByIdentifier(
    `2fa-attempts-${pending.identifier}`,
  );
  expireCookie(ctx, factorCookie(ctx));
}
