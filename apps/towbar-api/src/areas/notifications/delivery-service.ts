import { and, asc, eq, lte, or } from "drizzle-orm";
import { ZodError } from "zod";

import {
  notificationDeliveries,
  notificationDeliveryAttempts,
  notificationDestinations,
  notificationEvents,
  notificationThreads,
} from "@workspace/towbar-database/schema";

import { getTowbarDatabase } from "../../infrastructure/database.js";
import { enqueueNotificationDelivery } from "../../infrastructure/temporal.js";
import { getNotificationProviderConfiguration } from "./configuration.js";
import { NotificationProviderError, deliverNotification } from "./providers.js";

const maximumAutomaticAttempts = 5;

export async function enqueueDueNotificationDeliveries(now = new Date()) {
  const deliveries = await getTowbarDatabase()
    .select({
      cycle: notificationDeliveries.cycle,
      id: notificationDeliveries.id,
    })
    .from(notificationDeliveries)
    .where(
      or(
        eq(notificationDeliveries.state, "pending"),
        and(
          eq(notificationDeliveries.state, "retrying"),
          lte(notificationDeliveries.nextAttemptAt, now),
        ),
      ),
    )
    .orderBy(asc(notificationDeliveries.createdAt))
    .limit(100);
  await enqueueDeliveries(deliveries);
  return deliveries.length;
}

export async function executeNotificationDeliveryAttempt(input: {
  attempt: number;
  cycle: number;
  deliveryId: string;
}) {
  const claimed = await claimAttempt(input);
  if (claimed.outcome) return claimed.outcome;
  const { delivery } = claimed;
  try {
    const providerConfiguration = await getNotificationProviderConfiguration(
      delivery.provider,
      delivery.workspaceId,
    );
    if (!providerConfiguration) {
      throw new NotificationProviderError(
        "PROVIDER_NOT_CONFIGURED",
        `${delivery.provider === "slack" ? "Slack" : "SMTP"} notifications are not configured for this Towbar instance`,
        false,
      );
    }
    const thread = await claimNotificationThread(delivery);
    const result = await deliverNotification({
      config: delivery.config,
      eventId: delivery.eventId,
      eventType: delivery.eventType,
      payload: delivery.payload,
      provider: delivery.provider,
      providerConfiguration,
      thread,
    });
    await completeNotificationThread(delivery, {
      providerMessageId:
        "providerMessageId" in result ? result.providerMessageId : undefined,
      providerThreadId:
        "providerThreadId" in result ? result.providerThreadId : undefined,
      rootUpdated: "rootUpdated" in result ? result.rootUpdated : undefined,
    });
    await finishAttempt(input, {
      providerStatus: result.providerStatus,
      state: "succeeded",
    });
    return { outcome: "succeeded" as const };
  } catch (error) {
    await releaseNotificationThreadClaim(delivery).catch(() => undefined);
    const classified = classifyDeliveryError(error);
    const retryable =
      classified.retryable && input.attempt < maximumAutomaticAttempts;
    const retryAfterMs = retryable ? retryDelayMs(input.attempt) : null;
    await finishAttempt(input, {
      errorCode: classified.code,
      errorMessage: classified.message,
      providerStatus: classified.providerStatus,
      retryAfterMs,
      state: retryable ? "retryable_failure" : "terminal_failure",
    });
    return retryable
      ? { outcome: "retryable" as const, retryAfterMs: retryAfterMs! }
      : { outcome: "terminal" as const };
  }
}

export async function enqueueDeliveries(
  deliveries: Array<{ cycle: number; id: string }>,
) {
  await Promise.all(
    deliveries.map((delivery) =>
      enqueueNotificationDelivery({
        cycle: delivery.cycle,
        deliveryId: delivery.id,
      }).catch(() => undefined),
    ),
  );
}

export function retryDelayMs(failedAttempt: number) {
  return Math.min(5 * 60_000, 5_000 * 2 ** Math.max(0, failedAttempt - 1));
}

async function claimAttempt(input: {
  attempt: number;
  cycle: number;
  deliveryId: string;
}) {
  return await getTowbarDatabase().transaction(async (transaction) => {
    const [delivery] = await transaction
      .select({
        config: notificationDestinations.config,
        cycle: notificationDeliveries.cycle,
        destinationEnabled: notificationDestinations.enabled,
        destinationDeletedAt: notificationDestinations.deletedAt,
        destinationId: notificationDestinations.id,
        deliveryId: notificationDeliveries.id,
        workspaceId: notificationEvents.workspaceId,
        eventId: notificationEvents.id,
        eventType: notificationEvents.type,
        payload: notificationEvents.payload,
        provider: notificationDestinations.provider,
        state: notificationDeliveries.state,
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
      .where(eq(notificationDeliveries.id, input.deliveryId))
      .for("update")
      .limit(1);
    if (!delivery) return { outcome: { outcome: "terminal" as const } };
    if (delivery.cycle !== input.cycle || delivery.state === "succeeded") {
      return { outcome: { outcome: "stale" as const } };
    }
    if (!delivery.destinationEnabled || delivery.destinationDeletedAt) {
      await transaction
        .update(notificationDeliveries)
        .set({
          lastErrorCode: "DESTINATION_DISABLED",
          lastErrorMessage: "The notification destination is disabled",
          state: "failed",
          updatedAt: new Date(),
        })
        .where(eq(notificationDeliveries.id, input.deliveryId));
      return { outcome: { outcome: "terminal" as const } };
    }
    const [existing] = await transaction
      .select({
        startedAt: notificationDeliveryAttempts.startedAt,
        state: notificationDeliveryAttempts.state,
      })
      .from(notificationDeliveryAttempts)
      .where(
        and(
          eq(notificationDeliveryAttempts.deliveryId, input.deliveryId),
          eq(notificationDeliveryAttempts.cycle, input.cycle),
          eq(notificationDeliveryAttempts.sequence, input.attempt),
        ),
      )
      .limit(1);
    if (existing) {
      if (existing.state === "succeeded") {
        return { outcome: { outcome: "succeeded" as const } };
      }
      if (existing.state === "retryable_failure") {
        return {
          outcome: {
            outcome: "retryable" as const,
            retryAfterMs: retryDelayMs(input.attempt),
          },
        };
      }
      if (existing.state === "terminal_failure") {
        return { outcome: { outcome: "terminal" as const } };
      }
      return {
        outcome: {
          outcome: "wait" as const,
          retryAfterMs: Math.max(
            1_000,
            15_000 - (Date.now() - existing.startedAt.getTime()),
          ),
        },
      };
    }
    const now = new Date();
    await transaction.insert(notificationDeliveryAttempts).values({
      cycle: input.cycle,
      deliveryId: input.deliveryId,
      sequence: input.attempt,
    });
    await transaction
      .update(notificationDeliveries)
      .set({
        attemptCount: input.attempt,
        lastAttemptedAt: now,
        nextAttemptAt: null,
        state: "delivering",
        updatedAt: now,
      })
      .where(eq(notificationDeliveries.id, input.deliveryId));
    return { delivery };
  });
}

async function claimNotificationThread(delivery: {
  deliveryId: string;
  destinationId: string;
  eventType: string;
  payload: {
    entity: { id: string; kind: string };
    occurredAt: string;
  };
  provider: string;
}) {
  if (
    delivery.provider !== "slack" ||
    !delivery.eventType.startsWith("deployment.") ||
    delivery.payload.entity.kind !== "deployment"
  ) {
    return null;
  }
  return await getTowbarDatabase().transaction(async (transaction) => {
    await transaction
      .insert(notificationThreads)
      .values({
        creatingDeliveryId: delivery.deliveryId,
        destinationId: delivery.destinationId,
        entityId: delivery.payload.entity.id,
        entityKind: delivery.payload.entity.kind,
        latestEventAt: new Date(delivery.payload.occurredAt),
      })
      .onConflictDoNothing({
        target: [
          notificationThreads.destinationId,
          notificationThreads.entityKind,
          notificationThreads.entityId,
        ],
      });
    const [thread] = await transaction
      .select()
      .from(notificationThreads)
      .where(
        and(
          eq(notificationThreads.destinationId, delivery.destinationId),
          eq(notificationThreads.entityKind, delivery.payload.entity.kind),
          eq(notificationThreads.entityId, delivery.payload.entity.id),
        ),
      )
      .for("update")
      .limit(1);
    if (!thread) throw new Error("Unable to reserve notification thread");
    const claimExpired = Date.now() - thread.updatedAt.getTime() >= 2 * 60_000;
    if (
      thread.creatingDeliveryId &&
      thread.creatingDeliveryId !== delivery.deliveryId &&
      !claimExpired
    ) {
      throw new NotificationProviderError(
        "NOTIFICATION_THREAD_PENDING",
        "The deployment notification thread is processing another event",
        true,
      );
    }
    await transaction
      .update(notificationThreads)
      .set({
        creatingDeliveryId: delivery.deliveryId,
        updatedAt: new Date(),
      })
      .where(eq(notificationThreads.id, thread.id));
    if (thread.providerMessageId && thread.providerThreadId) {
      const eventAt = new Date(delivery.payload.occurredAt);
      return {
        messageId: thread.providerMessageId,
        threadId: thread.providerThreadId,
        updateRoot: eventAt.getTime() >= thread.latestEventAt.getTime(),
      };
    }
    return null;
  });
}

async function completeNotificationThread(
  delivery: {
    deliveryId: string;
    destinationId: string;
    eventType: string;
    payload: { entity: { id: string; kind: string }; occurredAt: string };
    provider: string;
  },
  result: {
    providerMessageId?: string;
    providerThreadId?: string;
    rootUpdated?: boolean;
  },
) {
  if (
    delivery.provider !== "slack" ||
    !delivery.eventType.startsWith("deployment.") ||
    !result.providerMessageId ||
    !result.providerThreadId
  ) {
    return;
  }
  await getTowbarDatabase()
    .update(notificationThreads)
    .set({
      creatingDeliveryId: null,
      ...(result.rootUpdated
        ? { latestEventAt: new Date(delivery.payload.occurredAt) }
        : {}),
      providerMessageId: result.providerMessageId,
      providerThreadId: result.providerThreadId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(notificationThreads.destinationId, delivery.destinationId),
        eq(notificationThreads.entityKind, delivery.payload.entity.kind),
        eq(notificationThreads.entityId, delivery.payload.entity.id),
        eq(notificationThreads.creatingDeliveryId, delivery.deliveryId),
      ),
    );
}

async function releaseNotificationThreadClaim(delivery: {
  deliveryId: string;
  destinationId: string;
  eventType: string;
  payload: { entity: { id: string; kind: string } };
  provider: string;
}) {
  if (
    delivery.provider !== "slack" ||
    !delivery.eventType.startsWith("deployment.")
  ) {
    return;
  }
  await getTowbarDatabase()
    .update(notificationThreads)
    .set({ creatingDeliveryId: null, updatedAt: new Date() })
    .where(
      and(
        eq(notificationThreads.destinationId, delivery.destinationId),
        eq(notificationThreads.entityKind, delivery.payload.entity.kind),
        eq(notificationThreads.entityId, delivery.payload.entity.id),
        eq(notificationThreads.creatingDeliveryId, delivery.deliveryId),
      ),
    );
}

async function finishAttempt(
  input: { attempt: number; cycle: number; deliveryId: string },
  outcome:
    | { providerStatus?: string; state: "succeeded" }
    | {
        errorCode: string;
        errorMessage: string;
        providerStatus?: string;
        retryAfterMs: number | null;
        state: "retryable_failure" | "terminal_failure";
      },
) {
  const now = new Date();
  await getTowbarDatabase().transaction(async (transaction) => {
    await transaction
      .update(notificationDeliveryAttempts)
      .set({
        errorCode: outcome.state === "succeeded" ? null : outcome.errorCode,
        errorMessage:
          outcome.state === "succeeded" ? null : outcome.errorMessage,
        finishedAt: now,
        providerStatus: outcome.providerStatus?.slice(0, 100),
        state: outcome.state,
      })
      .where(
        and(
          eq(notificationDeliveryAttempts.deliveryId, input.deliveryId),
          eq(notificationDeliveryAttempts.cycle, input.cycle),
          eq(notificationDeliveryAttempts.sequence, input.attempt),
        ),
      );
    await transaction
      .update(notificationDeliveries)
      .set(
        outcome.state === "succeeded"
          ? {
              deliveredAt: now,
              lastErrorCode: null,
              lastErrorMessage: null,
              nextAttemptAt: null,
              state: "succeeded",
              updatedAt: now,
            }
          : {
              lastErrorCode: outcome.errorCode,
              lastErrorMessage: outcome.errorMessage,
              nextAttemptAt: outcome.retryAfterMs
                ? new Date(now.getTime() + outcome.retryAfterMs)
                : null,
              state: outcome.retryAfterMs ? "retrying" : "failed",
              updatedAt: now,
            },
      )
      .where(
        and(
          eq(notificationDeliveries.id, input.deliveryId),
          eq(notificationDeliveries.cycle, input.cycle),
        ),
      );
  });
}

function classifyDeliveryError(error: unknown) {
  if (error instanceof NotificationProviderError) return error;
  if (error instanceof ZodError) {
    return new NotificationProviderError(
      "INVALID_DESTINATION_CONFIGURATION",
      "The notification destination does not match the required format",
      false,
    );
  }
  return new NotificationProviderError(
    "NOTIFICATION_DELIVERY_FAILED",
    "The notification could not be delivered",
    true,
  );
}
