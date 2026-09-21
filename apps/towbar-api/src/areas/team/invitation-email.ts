import { recordAuditEvent } from "../../infrastructure/audit.js";
import type { AuthDatabase } from "../../infrastructure/database.js";
import { auditAttribution } from "../auth/actor-context.js";
import { enqueueAdminEmail } from "./email-outbox.js";

export async function invitationAccepted(
  tx: AuthDatabase,
  row: {
    invitation: {
      id: string;
      workspaceId: string;
      email: string;
      role: string;
    };
  },
  userId: string,
) {
  await recordAuditEvent(tx, {
    workspaceId: row.invitation.workspaceId,
    actorKind: "session",
    actorUserId: userId,
    action: "invitation.accepted",
    targetType: "invitation",
    targetId: row.invitation.id,
    ...auditAttribution(),
  });
  await enqueueAdminEmail(tx, {
    workspaceId: row.invitation.workspaceId,
    template: "invitation-accepted",
    dedupeKey: `invitation-accepted:${row.invitation.id}`,
    data: { name: row.invitation.email, role: row.invitation.role },
  });
}
