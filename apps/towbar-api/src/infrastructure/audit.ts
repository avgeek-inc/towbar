import {
  type AuditEventSlug,
  type AuditMetadata,
  auditEventMetadata,
  isAuditEventSlug,
} from "@workspace/towbar-core";
import { auditEvents } from "@workspace/towbar-database/schema";
import type { AuthDatabase } from "./database.js";
import { auditRequestContext } from "./audit-context.js";

export type AuditEventInput = Omit<
  typeof auditEvents.$inferInsert,
  "action" | "metadata"
> & {
  action: AuditEventSlug;
  metadata?: AuditMetadata;
};

/** Use the caller's transaction so a successful action and its audit record commit together. */
export async function recordAuditEvent(
  database: Pick<AuthDatabase, "insert">,
  event: AuditEventInput,
) {
  if (!isAuditEventSlug(event.action))
    throw new Error("Unregistered audit event");
  await database.insert(auditEvents).values({
    ...event,
    actorKind: event.actorKind ?? (event.actorUserId ? "session" : "system"),
    requestId: event.requestId ?? auditRequestContext.getStore() ?? null,
    metadata: auditEventMetadata(event.action, event.metadata ?? {}),
  });
}
