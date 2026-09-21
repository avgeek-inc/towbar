import { and, desc, eq, gt } from "drizzle-orm";
import { APIError } from "better-auth/api";
import { transactionalEmails, users } from "@workspace/towbar-database/schema";
import type { AuthDatabase } from "../../infrastructure/database.js";
import { enqueueIdentityEmail } from "../team/email-outbox.js";

export async function enqueueVerificationEmail(
  database: AuthDatabase,
  input: {
    userId: string;
    email: string;
    name: string;
    actionUrl: string;
    expiresAt: Date;
    workspaceId?: string;
  },
) {
  await database.transaction(async (tx) => {
    const [user] = await tx
      .select()
      .from(users)
      .where(eq(users.id, input.userId))
      .for("update");
    if (
      !user ||
      user.disabledAt ||
      user.email !== input.email ||
      user.emailVerified
    )
      throw new APIError("BAD_REQUEST", {
        message: "This email address does not need verification.",
      });
    const now = Date.now();
    const recent = await tx
      .select({ createdAt: transactionalEmails.createdAt })
      .from(transactionalEmails)
      .where(
        and(
          eq(transactionalEmails.recipient, user.email),
          eq(transactionalEmails.template, "email-verification"),
          gt(transactionalEmails.createdAt, new Date(now - 24 * 60 * 60_000)),
        ),
      )
      .orderBy(desc(transactionalEmails.createdAt))
      .limit(5);
    if (recent.length >= 5)
      throw new APIError("TOO_MANY_REQUESTS", {
        code: "EMAIL_VERIFICATION_LIMIT",
        message:
          "You’ve requested 5 confirmation emails in the last 24 hours. Try again later.",
      });
    if (recent[0] && recent[0].createdAt.getTime() > now - 60_000)
      throw new APIError("TOO_MANY_REQUESTS", {
        code: "EMAIL_VERIFICATION_COOLDOWN",
        message:
          "Wait at least one minute before requesting another confirmation email.",
      });
    await enqueueIdentityEmail(tx, {
      ...input,
      template: "email-verification",
    });
  });
}
