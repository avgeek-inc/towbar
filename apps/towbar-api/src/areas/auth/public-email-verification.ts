import { APIError } from "better-auth/api";
import { getEnv } from "../../env.js";
import { HttpError } from "../../http/errors.js";
import { incrementPersistentBucket } from "../../http/rate-limit.js";
import { getIdentityAuth } from "./identity.js";

export async function requestPublicVerificationEmail(
  email: string,
  clientAddress: string,
) {
  const now = new Date();
  const normalizedEmail = email.trim().toLowerCase();
  const policies = [
    {
      key: `verification-address:${clientAddress}`,
      limit: 20,
      duration: 60_000,
    },
    {
      key: `verification-email-minute:${normalizedEmail}`,
      limit: 1,
      duration: 60_000,
    },
    {
      key: `verification-email-day:${normalizedEmail}`,
      limit: 5,
      duration: 24 * 60 * 60_000,
    },
  ];
  const windows = await Promise.all(
    policies.map(async ({ key, limit, duration }) => ({
      ...(await incrementPersistentBucket(key, now, duration)),
      limit,
    })),
  );
  const blocked = windows.filter((window) => window.attempts > window.limit);
  if (blocked.length)
    throw new HttpError(
      429,
      "EMAIL_VERIFICATION_RATE_LIMITED",
      "Too many verification requests. Try again later.",
      {
        responseHeaders: {
          "Retry-After": String(
            Math.max(
              ...blocked.map((window) =>
                Math.max(
                  1,
                  Math.ceil(
                    (window.expiresAt.getTime() - now.getTime()) / 1000,
                  ),
                ),
              ),
            ),
          ),
        },
      },
    );
  try {
    // Public requests never inherit a signed-in account or a client-provided redirect.
    await getIdentityAuth().api.sendVerificationEmail({
      body: {
        email: normalizedEmail,
        callbackURL: `${new URL(getEnv().TOWBAR_APP_BASE_URL).origin}/login`,
      },
    });
  } catch (cause) {
    if (!(cause instanceof APIError)) throw cause;
    const privateRejection =
      (cause.status === "BAD_REQUEST" &&
        cause.body?.message ===
          "This email address does not need verification.") ||
      (cause.status === "TOO_MANY_REQUESTS" &&
        ["EMAIL_VERIFICATION_LIMIT", "EMAIL_VERIFICATION_COOLDOWN"].includes(
          String(cause.body?.code ?? ""),
        ));
    if (!privateRejection) throw cause;
    // Eligibility and the account's authenticated resend budget are private.
  }
}
