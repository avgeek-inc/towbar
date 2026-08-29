import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, isNull } from "drizzle-orm";

import {
  notificationCategoryForEvent,
  notificationDestinationInputSchema,
  notificationEventPayloadSchema,
} from "@workspace/towbar-core";
import {
  notificationDeliveries,
  notificationDestinations,
  notificationEvents,
  sources,
} from "@workspace/towbar-database/schema";

import { conflict, notFound } from "../../http/errors.js";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import { getSource } from "../sources/service.js";
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
  name: notificationDestinations.name,
  provider: notificationDestinations.provider,
  secretReference: notificationDestinations.secretReference,
  sourceId: notificationDestinations.sourceId,
  updatedAt: notificationDestinations.updatedAt,
};

export async function listNotificationDestinations(input: {
  sourceId: string;
  workspaceId: string;
}) {
  await getSource(input.sourceId, input.workspaceId);
  return await getTowbarDatabase()
    .select(publicDestinationSelection)
    .from(notificationDestinations)
    .where(
      and(
        eq(notificationDestinations.sourceId, input.sourceId),
        eq(notificationDestinations.workspaceId, input.workspaceId),
        isNull(notificationDestinations.deletedAt),
      ),
    )
    .orderBy(asc(notificationDestinations.name));
}

export async function createNotificationDestination(input: {
  destination: NotificationDestinationInput;
  sourceId: string;
  workspaceId: string;
}) {
  await getSource(input.sourceId, input.workspaceId);
  const destination = notificationDestinationInputSchema.parse(
    input.destination,
  );
  const [created] = await getTowbarDatabase()
    .insert(notificationDestinations)
    .values({
      ...destination,
      sourceId: input.sourceId,
      workspaceId: input.workspaceId,
    })
    .returning(publicDestinationSelection);
  if (!created) throw new Error("Unable to create notification destination");
  return created;
}

export async function updateNotificationDestination(input: {
  destination: NotificationDestinationInput;
  destinationId: string;
  sourceId: string;
  workspaceId: string;
}) {
  const destination = notificationDestinationInputSchema.parse(
    input.destination,
  );
  const [updated] = await getTowbarDatabase()
    .update(notificationDestinations)
    .set({ ...destination, updatedAt: new Date() })
    .where(
      and(
        eq(notificationDestinations.id, input.destinationId),
        eq(notificationDestinations.sourceId, input.sourceId),
        eq(notificationDestinations.workspaceId, input.workspaceId),
        isNull(notificationDestinations.deletedAt),
      ),
    )
    .returning(publicDestinationSelection);
  if (!updated) throw notFound("Notification destination");
  return updated;
}

export async function deleteNotificationDestination(input: {
  destinationId: string;
  sourceId: string;
  workspaceId: string;
}) {
  const now = new Date();
  const [deleted] = await getTowbarDatabase()
    .update(notificationDestinations)
    .set({ deletedAt: now, enabled: false, updatedAt: now })
    .where(
      and(
        eq(notificationDestinations.id, input.destinationId),
        eq(notificationDestinations.sourceId, input.sourceId),
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
  sourceId: string;
  targetDestinationId?: string;
  type: NotificationEventType;
  workspaceId: string;
}) {
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
        sourceId: input.sourceId,
        type: input.type,
        workspaceId: input.workspaceId,
      })
      .onConflictDoNothing({
        target: [notificationEvents.sourceId, notificationEvents.dedupeKey],
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
          eq(notificationDestinations.sourceId, input.sourceId),
          eq(notificationDestinations.workspaceId, input.workspaceId),
          eq(notificationDestinations.enabled, true),
          isNull(notificationDestinations.deletedAt),
          input.targetDestinationId
            ? eq(notificationDestinations.id, input.targetDestinationId)
            : undefined,
        ),
      );
    const matching = destinations.filter(
      (destination) =>
        category === "test" || destination.categories.includes(category),
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
  sourceId: string;
  workspaceId: string;
}) {
  const [source] = await getTowbarDatabase()
    .select({
      id: sources.id,
      repositoryName: sources.repositoryName,
    })
    .from(sources)
    .innerJoin(
      notificationDestinations,
      eq(notificationDestinations.sourceId, sources.id),
    )
    .where(
      and(
        eq(sources.id, input.sourceId),
        eq(sources.workspaceId, input.workspaceId),
        eq(notificationDestinations.id, input.destinationId),
        isNull(notificationDestinations.deletedAt),
      ),
    )
    .limit(1);
  if (!source) throw notFound("Notification destination");
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
      source: { id: source.id, name: source.repositoryName },
      title: "Test notification",
    },
    sourceId: input.sourceId,
    targetDestinationId: input.destinationId,
    type: "notification.test",
    workspaceId: input.workspaceId,
  });
  const delivery = result.deliveries[0];
  if (!delivery) throw conflict("This notification destination is disabled");
  return delivery;
}

export async function listNotificationDeliveries(input: {
  limit?: number;
  sourceId: string;
  workspaceId: string;
}) {
  await getSource(input.sourceId, input.workspaceId);
  return await getTowbarDatabase()
    .select({
      attemptCount: notificationDeliveries.attemptCount,
      category: notificationEvents.category,
      createdAt: notificationDeliveries.createdAt,
      cycle: notificationDeliveries.cycle,
      deliveredAt: notificationDeliveries.deliveredAt,
      destinationId: notificationDestinations.id,
      destinationName: notificationDestinations.name,
      errorCode: notificationDeliveries.lastErrorCode,
      errorMessage: notificationDeliveries.lastErrorMessage,
      eventId: notificationEvents.id,
      eventType: notificationEvents.type,
      id: notificationDeliveries.id,
      nextAttemptAt: notificationDeliveries.nextAttemptAt,
      payload: notificationEvents.payload,
      provider: notificationDestinations.provider,
      state: notificationDeliveries.state,
      updatedAt: notificationDeliveries.updatedAt,
    })
    .from(notificationDeliveries)
    .innerJoin(
      notificationEvents,
      eq(notificationEvents.id, notificationDeliveries.eventId),
    )
    .innerJoin(
      notificationDestinations,
      eq(notificationDestinations.id, notificationDeliveries.destinationId),
    )
    .where(
      and(
        eq(notificationEvents.sourceId, input.sourceId),
        eq(notificationEvents.workspaceId, input.workspaceId),
      ),
    )
    .orderBy(desc(notificationDeliveries.createdAt))
    .limit(Math.min(input.limit ?? 100, 200));
}

export async function retryNotificationDelivery(input: {
  deliveryId: string;
  sourceId: string;
  workspaceId: string;
}) {
  const now = new Date();
  const delivery = await getTowbarDatabase().transaction(
    async (transaction) => {
      const [current] = await transaction
        .select({
          cycle: notificationDeliveries.cycle,
          id: notificationDeliveries.id,
          state: notificationDeliveries.state,
        })
        .from(notificationDeliveries)
        .innerJoin(
          notificationEvents,
          eq(notificationEvents.id, notificationDeliveries.eventId),
        )
        .where(
          and(
            eq(notificationDeliveries.id, input.deliveryId),
            eq(notificationEvents.sourceId, input.sourceId),
            eq(notificationEvents.workspaceId, input.workspaceId),
          ),
        )
        .for("update")
        .limit(1);
      if (!current || current.state !== "failed") return null;
      const [updated] = await transaction
        .update(notificationDeliveries)
        .set({
          attemptCount: 0,
          cycle: current.cycle + 1,
          deliveredAt: null,
          lastAttemptedAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
          nextAttemptAt: null,
          state: "pending",
          updatedAt: now,
        })
        .where(eq(notificationDeliveries.id, current.id))
        .returning({
          cycle: notificationDeliveries.cycle,
          id: notificationDeliveries.id,
        });
      return updated ?? null;
    },
  );
  if (!delivery)
    throw conflict("Only failed notification deliveries can be retried");
  await enqueueDeliveries([delivery]);
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
