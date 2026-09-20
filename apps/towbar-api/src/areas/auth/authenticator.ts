import { createOTP } from "@better-auth/utils/otp";
import { generateRandomString, symmetricEncrypt } from "better-auth/crypto";
import { and, eq, ne } from "drizzle-orm";
import {
  authTwoFactors,
  sessions,
  users,
} from "@workspace/towbar-database/schema";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import { HttpError, conflict, forbidden } from "../../http/errors.js";
import {
  clearPersistentBucket,
  incrementPersistentBucket,
} from "../../http/rate-limit.js";
import { createIdentityAuth } from "./identity.js";
import { enqueueIdentityEmail } from "../team/email-outbox.js";

function recoveryCodes() {
  return Array.from({ length: 10 }, () => {
    const code = generateRandomString(10, "a-z", "A-Z", "0-9");
    return `${code.slice(0, 5)}-${code.slice(5)}`;
  });
}
export async function setupAuthenticator(userId: string) {
  return getTowbarDatabase().transaction(async (tx) => {
    const [user] = await tx
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .for("update");
    if (!user || user.disabledAt || user.mustChangePassword)
      throw forbidden("Finish account setup to continue");
    if (user.twoFactorEnabled)
      throw conflict("An authenticator app is already enabled");
    const auth = await createIdentityAuth(tx).$context;
    const secret = generateRandomString(32);
    const backupCodes = recoveryCodes();
    const values = {
      secret: await symmetricEncrypt({ key: auth.secretConfig, data: secret }),
      backupCodes: await symmetricEncrypt({
        key: auth.secretConfig,
        data: JSON.stringify(backupCodes),
      }),
      verified: false,
    };
    await tx
      .insert(authTwoFactors)
      .values({ userId, ...values })
      .onConflictDoUpdate({ target: authTwoFactors.userId, set: values });
    return {
      totpURI: createOTP(secret, { digits: 6, period: 30 }).url(
        "Towbar",
        user.email,
      ),
      backupCodes,
    };
  });
}
export async function manageAuthenticator(input: {
  userId: string;
  sessionId: string;
  headers: Headers;
  code: string;
  action: "disable" | "recovery";
}) {
  const bucketKey = `authenticator-settings:${input.userId}`;
  const bucket = await incrementPersistentBucket(
    bucketKey,
    new Date(),
    10 * 60_000,
  );
  if (bucket.attempts > 5)
    throw new HttpError(
      429,
      "AUTH_RATE_LIMITED",
      "Too many attempts. Try again in ten minutes.",
      { responseHeaders: { "Retry-After": "600" } },
    );
  const result = await getTowbarDatabase().transaction(async (tx) => {
    const [user] = await tx
      .select()
      .from(users)
      .where(eq(users.id, input.userId))
      .for("update");
    if (!user || user.disabledAt || !user.twoFactorEnabled)
      throw forbidden("An authenticator app is not enabled");
    const auth = createIdentityAuth(tx);
    const verified = await auth.api.verifyTOTP({
      headers: input.headers,
      body: { code: input.code },
      asResponse: true,
    });
    if (!verified.ok) return { error: verified };
    const codes = input.action === "recovery" ? recoveryCodes() : [];
    if (input.action === "disable") {
      await tx.delete(authTwoFactors).where(eq(authTwoFactors.userId, user.id));
      await tx
        .update(users)
        .set({ twoFactorEnabled: false, updatedAt: new Date() })
        .where(eq(users.id, user.id));
      await tx
        .delete(sessions)
        .where(
          and(eq(sessions.userId, user.id), ne(sessions.id, input.sessionId)),
        );
    } else {
      await tx
        .update(authTwoFactors)
        .set({
          backupCodes: await symmetricEncrypt({
            key: (await auth.$context).secretConfig,
            data: JSON.stringify(codes),
          }),
        })
        .where(eq(authTwoFactors.userId, user.id));
    }
    await enqueueIdentityEmail(tx, {
      userId: user.id,
      email: user.email,
      name: user.displayName,
      template: "mfa-changed",
    });
    return { backupCodes: codes };
  });
  if (result.error)
    throw new HttpError(
      result.error.status === 429 ? 429 : 400,
      "AUTHENTICATOR_CODE_INVALID",
      "The authenticator code is invalid or has expired. Try a new code.",
    );
  await clearPersistentBucket(bucketKey);
  return { backupCodes: result.backupCodes };
}
