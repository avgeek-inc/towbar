import type { AuditEventSlug } from "@workspace/towbar-core";
import { recordAuditEvent } from "../../infrastructure/audit.js";
import { auditAttribution } from "../auth/actor-context.js";
import type { AuthDatabase } from "../../infrastructure/database.js";
import type { AuthenticatedUser } from "../../http/types.js";
export async function audit(
  tx: AuthDatabase,
  user: AuthenticatedUser,
  action: AuditEventSlug,
  targetId: string,
  metadata: Record<string, string | number | boolean | null> = {},
) {
  await recordAuditEvent(tx, {
    workspaceId: user.workspaceId,
    actorKind: "session",
    actorUserId: user.id,
    action,
    targetType: action.split(".")[0]!,
    targetId,
    metadata,
    ...auditAttribution(),
  });
}
