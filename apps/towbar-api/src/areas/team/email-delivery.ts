import { randomUUID } from "node:crypto";
import { and, eq, gt, inArray, isNull, lt, lte, or } from "drizzle-orm";
import {
  decryptCredential,
  parseCredentialsMasterKey,
} from "@workspace/towbar-core";
import {
  transactionalEmails,
  users,
  workspaceInvitations,
  workspaceMembers,
} from "@workspace/towbar-database/schema";
import {
  type TransactionalEmailData,
  type TransactionalTemplate,
  renderTransactionalEmail,
  transactionalTemplates,
} from "@workspace/towbar-email";
import { getEnv } from "../../env.js";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import { enqueueTransactionalEmail } from "../../infrastructure/temporal.js";
import { getNotificationProviderConfiguration } from "../notifications/configuration.js";
import {
  NotificationProviderError,
  sendSmtpEmail,
} from "../notifications/providers.js";
import type { AuthDatabase } from "../../infrastructure/database.js";

const maximumAttempts = 5;
const leaseDurationMs = 120_000;
export type EmailDeliveryResult =
  { outcome: "done" } | { outcome: "wait"; retryAfterMs: number };
type OutboxRow = typeof transactionalEmails.$inferSelect;
async function invitationStillValid(
  database: AuthDatabase,
  row: OutboxRow,
  now: Date,
) {
  if (!row.invitationId) return true;
  const [invitation] = await database
    .select({ id: workspaceInvitations.id })
    .from(workspaceInvitations)
    .innerJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.userId, workspaceInvitations.inviterId),
        eq(workspaceMembers.workspaceId, workspaceInvitations.workspaceId),
      ),
    )
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(
      and(
        eq(workspaceInvitations.id, row.invitationId),
        eq(workspaceInvitations.workspaceId, row.workspaceId),
        eq(workspaceInvitations.status, "pending"),
        gt(workspaceInvitations.expiresAt, now),
        eq(workspaceMembers.role, "admin"),
        isNull(users.disabledAt),
      ),
    );
  return Boolean(invitation);
}
export async function enqueueDueTransactionalEmails(now = new Date()) {
  const database = getTowbarDatabase();
  await database
    .update(transactionalEmails)
    .set({
      status: "canceled",
      encryptedData: null,
      leaseToken: null,
      leaseUntil: null,
      errorCode: "EXPIRED",
    })
    .where(
      and(
        inArray(transactionalEmails.status, ["pending", "sending", "failed"]),
        lte(transactionalEmails.expiresAt, now),
      ),
    );
  const ready = await database
    .select({
      id: transactionalEmails.id,
      attempts: transactionalEmails.attempts,
    })
    .from(transactionalEmails)
    .where(
      or(
        and(
          eq(transactionalEmails.status, "pending"),
          lte(transactionalEmails.nextAttemptAt, now),
        ),
        and(
          eq(transactionalEmails.status, "sending"),
          lt(transactionalEmails.leaseUntil, now),
        ),
      ),
    )
    .limit(100);
  await Promise.all(
    ready.map((row) =>
      enqueueTransactionalEmail(row.id, row.attempts).catch(() => undefined),
    ),
  );
  return ready.length;
}
export async function executeTransactionalEmail(
  id: string,
  dependencies = {
    send: sendSmtpEmail,
    configuration: getNotificationProviderConfiguration,
    now: () => new Date(),
  },
): Promise<EmailDeliveryResult> {
  const database = getTowbarDatabase();
  const now = dependencies.now();
  const leaseToken = randomUUID();
  const claim = await database.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(transactionalEmails)
      .where(eq(transactionalEmails.id, id))
      .for("update");
    if (!row || ["sent", "canceled", "failed"].includes(row.status))
      return { outcome: "done" } as const;
    if (
      (row.expiresAt && row.expiresAt <= now) ||
      !(await invitationStillValid(tx, row, now))
    ) {
      await tx
        .update(transactionalEmails)
        .set({
          status: "canceled",
          encryptedData: null,
          leaseToken: null,
          leaseUntil: null,
        })
        .where(eq(transactionalEmails.id, id));
      return { outcome: "done" } as const;
    }
    if (row.status === "sending" && row.leaseUntil && row.leaseUntil > now)
      return {
        outcome: "wait",
        retryAfterMs: row.leaseUntil.getTime() - now.getTime(),
      } as const;
    if (row.nextAttemptAt > now)
      return {
        outcome: "wait",
        retryAfterMs: row.nextAttemptAt.getTime() - now.getTime(),
      } as const;
    if (row.attempts >= maximumAttempts) {
      await tx
        .update(transactionalEmails)
        .set({
          status: "failed",
          encryptedData: null,
          errorCode: "RETRY_LIMIT",
          leaseToken: null,
          leaseUntil: null,
        })
        .where(eq(transactionalEmails.id, id));
      return { outcome: "done" } as const;
    }
    const [claimed] = await tx
      .update(transactionalEmails)
      .set({
        status: "sending",
        leaseToken,
        leaseUntil: new Date(now.getTime() + leaseDurationMs),
        attempts: row.attempts + 1,
      })
      .where(eq(transactionalEmails.id, id))
      .returning();
    return claimed!;
  });
  if ("outcome" in claim) return claim;
  const lease = and(
    eq(transactionalEmails.id, id),
    eq(transactionalEmails.leaseToken, leaseToken),
    eq(transactionalEmails.status, "sending"),
  );
  try {
    if (
      !claim.encryptedData ||
      !transactionalTemplates.includes(claim.template as TransactionalTemplate)
    )
      throw new NotificationProviderError(
        "INVALID_TEMPLATE",
        "Email template is unavailable",
        false,
      );
    const provider = await dependencies.configuration(
      claim.workspaceId,
      "smtp",
    );
    if (!provider || provider.provider !== "smtp")
      throw new NotificationProviderError(
        "SMTP_NOT_CONFIGURED",
        "Configure SMTP to send team email",
        true,
      );
    const data = decryptCredential<TransactionalEmailData>({
      associatedData: `towbar:transactional-email:${claim.workspaceId}:${claim.id}`,
      masterKey: parseCredentialsMasterKey(getEnv().TOWBAR_CREDENTIALS_KEY),
      envelope: claim.encryptedData,
    });
    const rendered = await renderTransactionalEmail(
      claim.template as TransactionalTemplate,
      data,
    );
    // Re-check revocation after rendering and credential resolution, before SMTP admission.
    const [active] = await database
      .select({ id: transactionalEmails.id })
      .from(transactionalEmails)
      .where(lease);
    if (
      !active ||
      (claim.expiresAt && claim.expiresAt <= dependencies.now()) ||
      !(await invitationStillValid(database, claim, dependencies.now()))
    ) {
      await database
        .update(transactionalEmails)
        .set({
          status: "canceled",
          encryptedData: null,
          leaseUntil: null,
          leaseToken: null,
        })
        .where(lease);
      return { outcome: "done" };
    }
    await dependencies.send(
      { ...rendered, messageId: claim.id, recipients: [claim.recipient] },
      provider,
    );
    await database
      .update(transactionalEmails)
      .set({
        status: "sent",
        sentAt: dependencies.now(),
        errorCode: null,
        encryptedData: null,
        leaseToken: null,
        leaseUntil: null,
      })
      .where(lease);
    return { outcome: "done" };
  } catch (error) {
    const retryable =
      error instanceof NotificationProviderError &&
      error.retryable &&
      claim.attempts < maximumAttempts;
    const retryAfterMs = Math.min(300_000, 15_000 * 2 ** (claim.attempts - 1));
    await database
      .update(transactionalEmails)
      .set({
        status: retryable ? "pending" : "failed",
        nextAttemptAt: new Date(dependencies.now().getTime() + retryAfterMs),
        errorCode:
          error instanceof NotificationProviderError
            ? error.code
            : "EMAIL_DELIVERY_FAILED",
        encryptedData: retryable ? claim.encryptedData : null,
        leaseToken: null,
        leaseUntil: null,
      })
      .where(lease);
    return retryable ? { outcome: "wait", retryAfterMs } : { outcome: "done" };
  }
}
