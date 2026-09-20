import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  notificationCategorySchema,
  notificationDeliveryStateSchema,
  notificationProviderSchema,
} from "@workspace/towbar-core";
import {
  notificationDeliveries,
  notificationEvents,
} from "@workspace/towbar-database/schema";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import { requireActor } from "../auth/actor-context.js";
import {
  cursorTimestamp,
  historyCursor,
  historyPage,
  historyQueryShape,
  pairedCursor,
  searchPattern,
} from "./query.js";

export const deliveriesQuery = z
  .object({
    ...historyQueryShape,
    provider: notificationProviderSchema.optional(),
    category: z
      .union([
        notificationCategorySchema,
        z.enum(["backupsAndRestores", "test"]),
      ])
      .optional(),
    state: notificationDeliveryStateSchema.optional(),
  })
  .refine(pairedCursor, "A cursor needs both before and beforeId");

export function notificationDestinationLabel(
  provider: string,
  config: Record<string, unknown>,
) {
  if (provider === "smtp" && Array.isArray(config.recipients))
    return config.recipients
      .filter((value): value is string => typeof value === "string")
      .join(", ");
  if (provider === "slack" && typeof config.channelId === "string")
    return config.channelId;
  if (provider === "telegram" && typeof config.chatId === "string")
    return (
      config.chatId +
      (typeof config.messageThreadId === "number"
        ? ` / Topic ${config.messageThreadId}`
        : "")
    );
  const host = provider === "discord" ? config.webhookHost : config.urlHost;
  return typeof host === "string" ? host : provider;
}
export async function listNotificationDeliveries(
  input: z.infer<typeof deliveriesQuery> & {
    workspaceId: string;
    sourceId?: string;
    serverId?: string;
  },
) {
  requireActor(input.workspaceId, ["notification.manage"]);
  const search = searchPattern(input.search);
  const rows = await getTowbarDatabase()
    .select({
      id: notificationDeliveries.id,
      eventId: notificationEvents.id,
      destinationId: notificationDeliveries.destinationKey,
      provider: notificationDeliveries.provider,
      type: notificationEvents.type,
      category: notificationEvents.category,
      title: sql<string>`${notificationEvents.payload}->>'title'`,
      entityId: sql<string>`${notificationEvents.payload}->'entity'->>'id'`,
      entityName: sql<string>`${notificationEvents.payload}->'entity'->>'name'`,
      sourceId: notificationEvents.sourceId,
      serverId: notificationEvents.serverId,
      state: notificationDeliveries.state,
      attemptCount: notificationDeliveries.attemptCount,
      cycle: notificationDeliveries.cycle,
      errorCode: notificationDeliveries.lastErrorCode,
      nextAttemptAt: notificationDeliveries.nextAttemptAt,
      lastAttemptedAt: notificationDeliveries.lastAttemptedAt,
      createdAt: notificationDeliveries.createdAt,
      deliveredAt: notificationDeliveries.deliveredAt,
      cursorTime: cursorTimestamp(notificationDeliveries.createdAt),
    })
    .from(notificationDeliveries)
    .innerJoin(
      notificationEvents,
      and(
        eq(notificationEvents.id, notificationDeliveries.eventId),
        eq(notificationEvents.workspaceId, input.workspaceId),
      ),
    )
    .where(
      and(
        input.sourceId
          ? eq(notificationEvents.sourceId, input.sourceId)
          : undefined,
        input.serverId
          ? eq(notificationEvents.serverId, input.serverId)
          : undefined,
        input.provider
          ? eq(notificationDeliveries.provider, input.provider)
          : undefined,
        input.state ? eq(notificationDeliveries.state, input.state) : undefined,
        input.category === "backupsAndRestores"
          ? inArray(notificationEvents.category, ["backups", "restores"])
          : input.category
            ? eq(notificationEvents.category, input.category)
            : undefined,
        historyCursor(
          notificationDeliveries.createdAt,
          notificationDeliveries.id,
          input,
        ),
        input.search
          ? or(
              ilike(notificationEvents.type, search),
              ilike(sql`${notificationEvents.payload}->>'title'`, search),
              ilike(
                sql`${notificationEvents.payload}->'entity'->>'name'`,
                search,
              ),
              ilike(sql`${notificationDeliveries.id}::text`, search),
            )
          : undefined,
      ),
    )
    .orderBy(
      desc(notificationDeliveries.createdAt),
      desc(notificationDeliveries.id),
    )
    .limit(input.limit + 1);
  const page = historyPage(rows, input.limit);
  return {
    ...page,
    items: page.items.map((row) => ({
      ...row,
      destination: row.destinationId,
    })),
  };
}
