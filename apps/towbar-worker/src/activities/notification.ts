import { signedApiRequest } from "../infrastructure/towbar-api.js";

export type NotificationDeliveryOutcome =
  | { outcome: "retryable" | "wait"; retryAfterMs: number }
  | { outcome: "stale" | "succeeded" | "terminal" };

export async function executeNotificationDeliveryActivity(input: {
  attempt: number;
  cycle: number;
  deliveryId: string;
}) {
  return await signedApiRequest<NotificationDeliveryOutcome>(
    "POST",
    `/v1/internal/notifications/${input.deliveryId}/attempt`,
    { attempt: input.attempt, cycle: input.cycle },
    { maximumAttempts: 1, timeoutMs: 20_000 },
  );
}
