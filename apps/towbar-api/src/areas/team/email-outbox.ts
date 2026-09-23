import { randomUUID } from "node:crypto";
import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import {
  encryptCredential,
  parseCredentialsMasterKey,
} from "@workspace/towbar-core";
import {
  transactionalEmails,
  users,
  workspaceInvitations,
  workspaceMembers,
  workspaces,
} from "@workspace/towbar-database/schema";
import { getEnv } from "../../env.js";
import type { AuthDatabase } from "../../infrastructure/database.js";

import type {
  TransactionalEmailData,
  TransactionalTemplate,
} from "@workspace/towbar-email";
export type {
  TransactionalTemplate,
  TransactionalEmailData,
} from "@workspace/towbar-email";
export async function enqueueTeamEmail(
  database: AuthDatabase,
  input: {
    workspaceId: string;
    recipient: string;
    template: TransactionalTemplate;
    data: TransactionalEmailData;
    dedupeKey: string;
    invitationId?: string;
    expiresAt?: Date;
  },
) {
  if (input.template === "invitation-verification") {
    await database
      .update(transactionalEmails)
      .set({ status: "canceled", encryptedData: null })
      .where(
        and(
          eq(transactionalEmails.workspaceId, input.workspaceId),
          eq(transactionalEmails.recipient, input.recipient),
          eq(transactionalEmails.template, input.template),
          inArray(transactionalEmails.status, ["pending", "sending"]),
        ),
      );
  }
  const id = randomUUID();
  const encryptedData = encryptCredential({
    associatedData: `towbar:transactional-email:${input.workspaceId}:${id}`,
    masterKey: parseCredentialsMasterKey(getEnv().TOWBAR_CREDENTIALS_KEY),
    value: input.data,
  });
  const [row] = await database
    .insert(transactionalEmails)
    .values({
      id,
      workspaceId: input.workspaceId,
      recipient: input.recipient,
      template: input.template,
      dedupeKey: input.dedupeKey,
      invitationId: input.invitationId,
      expiresAt: input.expiresAt,
      encryptedData,
    })
    .onConflictDoNothing({ target: transactionalEmails.dedupeKey })
    .returning({ id: transactionalEmails.id });
  return row?.id;
}
export async function enqueueIdentityEmail(
  database: AuthDatabase,
  input: {
    userId?: string;
    email: string;
    name: string;
    template: TransactionalTemplate;
    actionUrl?: string;
    expiresAt?: Date;
    workspaceId?: string;
    invitationId?: string;
    verificationCode?: string;
  },
) {
  const [membership] = input.userId
    ? await database
        .select({ workspaceId: workspaceMembers.workspaceId })
        .from(workspaceMembers)
        .where(eq(workspaceMembers.userId, input.userId))
        .limit(1)
    : [];
  const [invitation] =
    membership || input.workspaceId
      ? []
      : await database
          .select({ workspaceId: workspaceInvitations.workspaceId })
          .from(workspaceInvitations)
          .where(
            and(
              eq(workspaceInvitations.email, input.email),
              eq(workspaceInvitations.status, "pending"),
              gt(workspaceInvitations.expiresAt, new Date()),
            ),
          )
          .limit(1);
  const workspaceId =
    input.workspaceId ?? membership?.workspaceId ?? invitation?.workspaceId;
  if (!workspaceId) return;
  const [workspace] = await database
    .select({ name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  if (!workspace) return;
  return await enqueueTeamEmail(database, {
    workspaceId,
    recipient: input.email,
    template: input.template,
    expiresAt: input.expiresAt,
    invitationId: input.invitationId,
    dedupeKey: `identity:${input.template}:${randomUUID()}`,
    data: {
      name: input.name,
      teamName: workspace.name,
      actionUrl: input.actionUrl,
      verificationCode: input.verificationCode,
    },
  });
}

export async function enqueueAdminEmail(
  database: AuthDatabase,
  input: {
    workspaceId: string;
    template: TransactionalTemplate;
    dedupeKey: string;
    data: Omit<TransactionalEmailData, "teamName">;
  },
) {
  const [workspace] = await database
    .select({ name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.id, input.workspaceId));
  if (!workspace) return;
  const recipients = await database
    .select({ id: users.id, email: users.email })
    .from(users)
    .innerJoin(workspaceMembers, eq(workspaceMembers.userId, users.id))
    .where(
      and(
        eq(workspaceMembers.workspaceId, input.workspaceId),
        eq(workspaceMembers.role, "admin"),
        isNull(users.disabledAt),
      ),
    );
  for (const recipient of recipients)
    await enqueueTeamEmail(database, {
      workspaceId: input.workspaceId,
      recipient: recipient.email,
      template: input.template,
      dedupeKey: `${input.dedupeKey}:${recipient.id}`,
      data: { ...input.data, teamName: workspace.name },
    });
}
