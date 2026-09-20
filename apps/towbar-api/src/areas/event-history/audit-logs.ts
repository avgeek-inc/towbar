import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  auditEventCatalog,
  auditEventDefinitions,
  auditEventMetadata,
  isAuditEventSlug,
} from "@workspace/towbar-core";
import { auditEvents, users } from "@workspace/towbar-database/schema";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import type { AuthenticatedUser } from "../../http/types.js";
import { requireTeamAdmin } from "../team/authorization.js";
import {
  cursorTimestamp,
  historyCursor,
  historyPage,
  historyQueryShape,
  pairedCursor,
  searchPattern,
} from "./query.js";

export const auditLogsQuery = z
  .object({
    ...historyQueryShape,
    event: z.string().min(1).max(160).optional(),
    userId: z.uuid().optional(),
  })
  .refine(pairedCursor, "A cursor needs both before and beforeId");

export async function auditLogFilters(user: AuthenticatedUser) {
  const database = getTowbarDatabase();
  await requireTeamAdmin(database, user.workspaceId, user.id);
  const actors = await database
    .select({ id: users.id, name: users.displayName, email: users.email })
    .from(users)
    .where(
      sql`exists (select 1 from ${auditEvents} where ${auditEvents.actorUserId} = ${users.id} and ${auditEvents.workspaceId} = ${user.workspaceId})`,
    )
    .orderBy(users.displayName, users.id);
  return { events: auditEventDefinitions, users: actors };
}

export async function listAuditLogs(
  user: AuthenticatedUser,
  input: z.infer<typeof auditLogsQuery>,
) {
  const database = getTowbarDatabase();
  await requireTeamAdmin(database, user.workspaceId, user.id);
  const search = searchPattern(input.search);
  const labels = auditEventDefinitions
    .filter((event) =>
      event.label.toLowerCase().includes(input.search.toLowerCase()),
    )
    .map((event) => event.slug);
  const rows = await database
    .select({
      id: auditEvents.id,
      slug: auditEvents.action,
      targetType: auditEvents.targetType,
      targetId: auditEvents.targetId,
      metadata: auditEvents.metadata,
      actorKind: auditEvents.actorKind,
      actorUserId: auditEvents.actorUserId,
      actorKeyId: auditEvents.actorKeyId,
      actorName: users.displayName,
      actorEmail: users.email,
      requestId: auditEvents.requestId,
      createdAt: auditEvents.createdAt,
      cursorTime: cursorTimestamp(auditEvents.createdAt),
    })
    .from(auditEvents)
    .leftJoin(users, eq(users.id, auditEvents.actorUserId))
    .where(
      and(
        eq(auditEvents.workspaceId, user.workspaceId),
        input.event ? eq(auditEvents.action, input.event) : undefined,
        input.userId ? eq(auditEvents.actorUserId, input.userId) : undefined,
        historyCursor(auditEvents.createdAt, auditEvents.id, input),
        input.search
          ? or(
              ilike(auditEvents.action, search),
              ilike(auditEvents.targetType, search),
              ilike(auditEvents.targetId, search),
              ilike(users.displayName, search),
              ilike(users.email, search),
              ilike(sql`${auditEvents.id}::text`, search),
              ilike(auditEvents.requestId, search),
              labels.length ? inArray(auditEvents.action, labels) : undefined,
            )
          : undefined,
      ),
    )
    .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
    .limit(input.limit + 1);
  const page = historyPage(rows, input.limit);
  return {
    ...page,
    items: page.items.map((row) => ({
      ...row,
      label: isAuditEventSlug(row.slug)
        ? auditEventCatalog[row.slug].label
        : row.slug,
      icon: isAuditEventSlug(row.slug)
        ? auditEventCatalog[row.slug].icon
        : null,
      metadata: auditEventMetadata(row.slug, row.metadata),
    })),
  };
}
