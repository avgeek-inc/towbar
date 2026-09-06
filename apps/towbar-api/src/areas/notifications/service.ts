import { randomUUID } from "node:crypto";

import { and, desc, eq, isNull } from "drizzle-orm";

import {
  notificationCategoryForEvent,
  notificationDestinationInputSchema,
  notificationEventPayloadSchema,
} from "@workspace/towbar-core";
import {
  notificationDeliveries,
  notificationDestinations,
  notificationEvents,
  notificationThreads,
  sources,
} from "@workspace/towbar-database/schema";

import { badRequest, conflict, notFound } from "../../http/errors.js";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import { getServer } from "../servers/service.js";
import { getSource } from "../sources/service.js";
import { notificationProviderAvailability } from "./configuration.js";
import { enqueueDeliveries } from "./delivery-service.js";

import type {
  NotificationDestinationInput,
  NotificationEventPayload,
  NotificationEventType,
} from "@workspace/towbar-core";

const publicDestinationSelection = {
  categories: notificationDestinations.categories,
  config: notificationDestinations.config,
  createdAt: notificationDestinations.createdAt,
  enabled: notificationDestinations.enabled,
  id: notificationDestinations.id,
  provider: notificationDestinations.provider,
  sourceId: notificationDestinations.sourceId,
  serverId: notificationDestinations.serverId,
  updatedAt: notificationDestinations.updatedAt,
};

export async function listNotificationDestinations(input: {
  sourceId?: string;
  serverId?: string;
  workspaceId: string;
}) {
  await requireNotificationScope(input);
  return await getTowbarDatabase()
    .select(publicDestinationSelection)
    .from(notificationDestinations)
    .where(
      and(
        destinationScope(input),
        eq(notificationDestinations.workspaceId, input.workspaceId),
        isNull(notificationDestinations.deletedAt),
      ),
    )
    .orderBy(desc(notificationDestinations.createdAt));
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

export async function createNotificationDestination(input: {
  destination: NotificationDestinationInput;
  sourceId?: string;
  serverId?: string;
  workspaceId: string;
}) {
  await requireNotificationScope(input);
  const destination = notificationDestinationInputSchema.parse(
    input.serverId
      ? { ...input.destination, enabled: true, categories: ["scout"] }
      : input.destination,
  );
  requireAvailableProvider(destination);
  const [created] = await getTowbarDatabase()
    .insert(notificationDestinations)
    .values({
      ...destination,
      sourceId: input.sourceId ?? null,
      serverId: input.serverId ?? null,
      workspaceId: input.workspaceId,
    })
    .returning(publicDestinationSelection);
  if (!created) throw new Error("Unable to create notification destination");
  return created;
}

export async function updateNotificationDestination(input: {
  destination: NotificationDestinationInput;
  destinationId: string;
  sourceId?: string;
  serverId?: string;
  workspaceId: string;
}) {
  await requireNotificationScope(input);
  const destination = notificationDestinationInputSchema.parse(
    input.serverId
      ? { ...input.destination, enabled: true, categories: ["scout"] }
      : input.destination,
  );
  requireAvailableProvider(destination);
  const [updated] = await getTowbarDatabase().transaction(
    async (transaction) => {
      const [result] = await transaction
        .update(notificationDestinations)
        .set({ ...destination, updatedAt: new Date() })
        .where(
          and(
            eq(notificationDestinations.id, input.destinationId),
            destinationScope(input),
            eq(notificationDestinations.workspaceId, input.workspaceId),
            isNull(notificationDestinations.deletedAt),
          ),
        )
        .returning(publicDestinationSelection);
      if (result) {
        // A destination can move to a different Slack channel. New deployment
        // events must not update a root message created for the previous config.
        await transaction
          .delete(notificationThreads)
          .where(eq(notificationThreads.destinationId, input.destinationId));
      }
      return [result];
    },
  );
  if (!updated) throw notFound("Notification destination");
  return updated;
}

export async function deleteNotificationDestination(input: {
  destinationId: string;
  sourceId?: string;
  serverId?: string;
  workspaceId: string;
}) {
  await requireNotificationScope(input);
  const now = new Date();
  const [deleted] = await getTowbarDatabase()
    .update(notificationDestinations)
    .set({ deletedAt: now, enabled: false, updatedAt: now })
    .where(
      and(
        eq(notificationDestinations.id, input.destinationId),
        destinationScope(input),
        eq(notificationDestinations.workspaceId, input.workspaceId),
        isNull(notificationDestinations.deletedAt),
      ),
    )
    .returning({ id: notificationDestinations.id });
  if (!deleted) throw notFound("Notification destination");
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
  const database = getTowbarDatabase();
  const result = await database.transaction(async (transaction) => {
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
    if (!createdEvent) return { deliveries: [], eventId: null };

    const destinations = await transaction
      .select({
        categories: notificationDestinations.categories,
        id: notificationDestinations.id,
      })
      .from(notificationDestinations)
      .where(
        and(
          destinationScope(input),
          eq(notificationDestinations.workspaceId, input.workspaceId),
          input.serverId
            ? undefined
            : eq(notificationDestinations.enabled, true),
          isNull(notificationDestinations.deletedAt),
          input.targetDestinationId
            ? eq(notificationDestinations.id, input.targetDestinationId)
            : undefined,
        ),
      );
    const matching = destinations.filter(
      (destination) =>
        Boolean(input.serverId) ||
        category === "test" ||
        destination.categories.includes(category),
    );
    if (matching.length === 0) {
      return { deliveries: [], eventId: createdEvent.id };
    }
    const deliveries = await transaction
      .insert(notificationDeliveries)
      .values(
        matching.map((destination) => ({
          destinationId: destination.id,
          eventId: createdEvent.id,
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

export async function testNotificationDestination(input: {
  destinationId: string;
  sourceId?: string;
  serverId?: string;
  workspaceId: string;
}) {
  await requireNotificationScope(input);
  const [destination] = await getTowbarDatabase()
    .select({ id: notificationDestinations.id })
    .from(notificationDestinations)
    .where(
      and(
        eq(notificationDestinations.id, input.destinationId),
        eq(notificationDestinations.workspaceId, input.workspaceId),
        destinationScope(input),
        isNull(notificationDestinations.deletedAt),
      ),
    )
    .limit(1);
  if (!destination) throw notFound("Notification destination");
  const [source] = input.sourceId
    ? await getTowbarDatabase()
        .select({ id: sources.id, repositoryName: sources.repositoryName })
        .from(sources)
        .where(eq(sources.id, input.sourceId))
        .limit(1)
    : [];
  const eventId = randomUUID();
  const result = await emitNotificationEvent({
    dedupeKey: `notification-test:${eventId}`,
    payload: {
      details: {},
      entity: {
        id: input.destinationId,
        kind: "notification",
        name: "Notification destination",
      },
      message: "Towbar successfully reached this notification destination.",
      occurredAt: new Date().toISOString(),
      source: source ? { id: source.id, name: source.repositoryName } : null,
      title: "Test notification",
    },
    sourceId: input.sourceId,
    serverId: input.serverId,
    targetDestinationId: input.destinationId,
    type: "notification.test",
    workspaceId: input.workspaceId,
  });
  const delivery = result.deliveries[0];
  if (!delivery) throw conflict("This notification destination is disabled");
  return delivery;
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

function requireAvailableProvider(destination: NotificationDestinationInput) {
  if (
    destination.enabled &&
    !notificationProviderAvailability()[destination.provider]
  ) {
    throw conflict(
      `${destination.provider === "slack" ? "Slack" : "SMTP"} notifications are not configured for this Towbar instance`,
    );
  }
}

function destinationScope(input: { sourceId?: string; serverId?: string }) {
  return input.serverId
    ? eq(notificationDestinations.serverId, input.serverId)
    : eq(notificationDestinations.sourceId, input.sourceId!);
}
async function requireNotificationScope(input: {
  sourceId?: string;
  serverId?: string;
  workspaceId: string;
}) {
  if (Boolean(input.sourceId) === Boolean(input.serverId))
    throw badRequest("Choose one notification scope");
  if (input.serverId) await getServer(input.serverId, input.workspaceId);
  else await getSource(input.sourceId!, input.workspaceId);
}
