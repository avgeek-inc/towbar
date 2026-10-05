import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  authPasskeys,
  authRecoveryCodes,
  users,
} from "@workspace/towbar-database/schema";
import type { AuthDatabase } from "../../infrastructure/database.js";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import { forbidden } from "../../http/errors.js";
import { enqueueIdentityEmail } from "../team/email-outbox.js";

export function recoveryCodeHash(code: string) {
  return createHash("sha256")
    .update(code.trim().replaceAll("-", "").toLowerCase())
    .digest("hex");
}
export async function replaceRecoveryCodes(
  database: AuthDatabase,
  userId: string,
) {
  const codes = Array.from({ length: 10 }, () =>
    randomBytes(16).toString("hex").match(/.{8}/g)!.join("-"),
  );
  await database
    .insert(authRecoveryCodes)
    .values({ userId, codeHashes: codes.map(recoveryCodeHash) })
    .onConflictDoUpdate({
      target: authRecoveryCodes.userId,
      set: { codeHashes: codes.map(recoveryCodeHash), createdAt: new Date() },
    });
  return codes;
}
export async function regenerateRecoveryCodes(userId: string) {
  return getTowbarDatabase().transaction(async (tx) => {
    const [user] = await tx
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .for("update");
    const [key] = await tx
      .select({ id: authPasskeys.id })
      .from(authPasskeys)
      .where(eq(authPasskeys.userId, userId))
      .limit(1);
    if (!user || user.disabledAt || !key)
      throw forbidden("Add a passkey before generating recovery codes");
    const recoveryCodes = await replaceRecoveryCodes(tx, userId);
    await enqueueIdentityEmail(tx, {
      userId,
      email: user.email,
      name: user.displayName,
      template: "mfa-changed",
    });
    return { recoveryCodes };
  });
}
