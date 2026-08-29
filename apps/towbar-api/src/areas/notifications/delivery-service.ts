import { and, asc, eq, lte, or } from "drizzle-orm";
import { ZodError } from "zod";

import {
  notificationDeliveries,
  notificationDeliveryAttempts,
  notificationDestinations,
  notificationEvents,
} from "@workspace/towbar-database/schema";

import { getTowbarDatabase } from "../../infrastructure/database.js";
import { enqueueNotificationDelivery } from "../../infrastructure/temporal.js";
import { resolveAwsSecret } from "../aws/service.js";
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
    const secret = await resolveAwsSecret({
      secretReference: delivery.secretReference,
      sourceId: delivery.sourceId,
      workspaceId: delivery.workspaceId,
    });
    const result = await deliverNotification({
      config: delivery.config,
      eventId: delivery.eventId,
      payload: delivery.payload,
      provider: delivery.provider,
      secret,
    });
    await finishAttempt(input, {
      providerStatus: result.providerStatus,
      state: "succeeded",
    });
    return { outcome: "succeeded" as const };
  } catch (error) {
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
        eventId: notificationEvents.id,
        payload: notificationEvents.payload,
        provider: notificationDestinations.provider,
        secretReference: notificationDestinations.secretReference,
        sourceId: notificationEvents.sourceId,
        state: notificationDeliveries.state,
        workspaceId: notificationEvents.workspaceId,
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
      "The destination or its secret does not match the required format",
      false,
    );
  }
  return new NotificationProviderError(
    "SECRET_RESOLUTION_FAILED",
    "The destination secret could not be resolved",
    true,
  );
}
