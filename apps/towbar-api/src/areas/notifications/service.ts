import { desc, eq } from "drizzle-orm";
import {
  type NotificationEventPayload,
  type NotificationEventType,
  notificationCategoryForEvent,
  notificationEventPayloadSchema,
} from "@workspace/towbar-core";
import {
  notificationDeliveries,
  notificationEvents,
} from "@workspace/towbar-database/schema";

import { badRequest } from "../../http/errors.js";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import { getRuntimeNotifications } from "../../infrastructure/runtime-notifications.js";
import { getServer } from "../servers/service.js";
import { getSource } from "../sources/service.js";
import { enqueueDeliveries } from "./delivery-service.js";

export async function listNotificationDestinations(input: {
  sourceId?: string;
  serverId?: string;
  workspaceId: string;
}) {
  await requireNotificationScope(input);
  return getRuntimeNotifications().routes.map((route) => ({
    categories: route.categories,
    enabled: true,
    id: route.id,
    provider: route.provider,
    source: "environment" as const,
  }));
}

export async function listNotificationEvents(input: {
  limit?: number;
  workspaceId: string;
}) {
  return await getTowbarDatabase()
    .select({
      category: notificationEvents.category,
      createdAt: notificationEvents.createdAt,
      id: notificationEvents.id,
      occurredAt: notificationEvents.occurredAt,
      payload: notificationEvents.payload,
      type: notificationEvents.type,
    })
    .from(notificationEvents)
    .where(eq(notificationEvents.workspaceId, input.workspaceId))
    .orderBy(desc(notificationEvents.occurredAt))
    .limit(Math.min(input.limit ?? 20, 50));
}

export async function emitNotificationEvent(input: {
  dedupeKey: string;
  payload: NotificationEventPayload;
  sourceId?: string;
  serverId?: string;
  targetDestinationId?: string;
  type: NotificationEventType;
  workspaceId: string;
}) {
  await requireNotificationScope(input);
  const payload = notificationEventPayloadSchema.parse(input.payload);
  const category = notificationCategoryForEvent(input.type);
  const routes = getRuntimeNotifications().routes.filter(
    (route) =>
      (!input.targetDestinationId || route.id === input.targetDestinationId) &&
      (category === "test" || route.categories.includes(category)),
  );
  const result = await getTowbarDatabase().transaction(async (transaction) => {
    const [createdEvent] = await transaction
      .insert(notificationEvents)
      .values({
        category,
        dedupeKey: input.dedupeKey,
        occurredAt: new Date(payload.occurredAt),
        payload,
        sourceId: input.sourceId ?? null,
        serverId: input.serverId ?? null,
        type: input.type,
        workspaceId: input.workspaceId,
      })
      .onConflictDoNothing({
        target: [
          input.serverId
            ? notificationEvents.serverId
            : notificationEvents.sourceId,
          notificationEvents.dedupeKey,
        ],
      })
      .returning({ id: notificationEvents.id });
    if (!createdEvent || routes.length === 0)
      return { deliveries: [], eventId: createdEvent?.id ?? null };
    const deliveries = await transaction
      .insert(notificationDeliveries)
      .values(
        routes.map((route) => ({
          destinationKey: route.id,
          eventId: createdEvent.id,
          provider: route.provider,
        })),
      )
      .onConflictDoNothing()
      .returning({
        cycle: notificationDeliveries.cycle,
        id: notificationDeliveries.id,
      });
    return { deliveries, eventId: createdEvent.id };
  });
  await enqueueDeliveries(result.deliveries);
  return result;
}

export function notificationEventPayload(
  input: {
    details?: NotificationEventPayload["details"];
    entity: NotificationEventPayload["entity"];
    message: string;
    source: NotificationEventPayload["source"];
    title: string;
  },
  occurredAt = new Date(),
) {
  return notificationEventPayloadSchema.parse({
    details: input.details ?? {},
    entity: input.entity,
    message: input.message,
    occurredAt: occurredAt.toISOString(),
    source: input.source,
    title: input.title,
  });
}

async function requireNotificationScope(input: {
  sourceId?: string;
  serverId?: string;
  workspaceId: string;
}) {
  if (input.sourceId && input.serverId)
    throw badRequest("Choose one notification scope");
  if (input.serverId) await getServer(input.serverId, input.workspaceId);
  else if (input.sourceId) await getSource(input.sourceId, input.workspaceId);
}
