import { and, count, desc, eq, gte, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  notificationEvents,
  notificationReads,
} from "@workspace/towbar-database/schema";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import {
  cursorTimestamp,
  historyCursor,
  historyPage,
  pairedCursor,
} from "../event-history/query.js";

export const notificationCenterQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    before: z.iso.datetime({ offset: true }).optional(),
    beforeId: z.uuid().optional(),
  })
  .strict()
  .refine(pairedCursor, "A cursor needs both before and beforeId");

type NotificationOwner = { workspaceId: string; userId: string };
type Database = ReturnType<typeof getTowbarDatabase>;

function receiptScope(owner: NotificationOwner) {
  return and(
    eq(notificationReads.workspaceId, owner.workspaceId),
    eq(notificationReads.userId, owner.userId),
    eq(notificationReads.eventId, notificationEvents.id),
  );
}

export async function listNotificationCenter(
  owner: NotificationOwner,
  input: z.infer<typeof notificationCenterQuery>,
  database: Database = getTowbarDatabase(),
) {
  const scope = eq(notificationEvents.workspaceId, owner.workspaceId);
  // One snapshot keeps the page and total unread badge consistent.
  return database.transaction(
    async (tx) => {
      const [totals] = await tx
        .select({ unreadCount: count() })
        .from(notificationEvents)
        .leftJoin(notificationReads, receiptScope(owner))
        .where(and(scope, isNull(notificationReads.readAt)));
      const rows = await tx
        .select({
          category: notificationEvents.category,
          createdAt: notificationEvents.createdAt,
          id: notificationEvents.id,
          occurredAt: notificationEvents.occurredAt,
          payload: notificationEvents.payload,
          type: notificationEvents.type,
          readAt: notificationReads.readAt,
          cursorTime: cursorTimestamp(notificationEvents.occurredAt),
        })
        .from(notificationEvents)
        .leftJoin(notificationReads, receiptScope(owner))
        .where(
          and(
            scope,
            or(
              isNull(notificationReads.readAt),
              gte(notificationReads.readAt, sql`now() - interval '1 day'`),
            ),
            historyCursor(
              notificationEvents.occurredAt,
              notificationEvents.id,
              input,
            ),
          ),
        )
        .orderBy(
          desc(notificationEvents.occurredAt),
          desc(notificationEvents.id),
        )
        .limit(input.limit + 1);
      const page = historyPage(rows, input.limit);
      return {
        notifications: page.items,
        nextCursor: page.nextCursor,
        unreadCount: totals?.unreadCount ?? 0,
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

export async function markAllNotificationsRead(
  owner: NotificationOwner,
  database: Database = getTowbarDatabase(),
) {
  // INSERT SELECT sees one statement snapshot: later arrivals stay unread.
  // Existing receipts keep their original readAt, so retries cannot extend retention.
  await database.execute(sql`
    insert into ${notificationReads} (workspace_id, user_id, event_id, read_at)
    select ${owner.workspaceId}::uuid, ${owner.userId}::uuid, ${notificationEvents.id}, statement_timestamp()
    from ${notificationEvents}
    where ${notificationEvents.workspaceId} = ${owner.workspaceId}::uuid
      and not exists (
        select 1 from ${notificationReads}
        where ${notificationReads.workspaceId} = ${owner.workspaceId}::uuid
          and ${notificationReads.userId} = ${owner.userId}::uuid
          and ${notificationReads.eventId} = ${notificationEvents.id}
      )
    on conflict (workspace_id, user_id, event_id) do nothing
  `);
  return { ok: true as const };
}
