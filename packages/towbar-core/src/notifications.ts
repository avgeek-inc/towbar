import { z } from "zod";

export const notificationProviders = ["slack", "smtp"] as const;
export const notificationProviderSchema = z.enum(notificationProviders);
export type NotificationProvider = z.infer<typeof notificationProviderSchema>;

export const notificationCategories = [
  "deployments",
  "previews",
  "health",
  "backups",
  "restores",
] as const;
export const notificationCategorySchema = z.enum(notificationCategories);
export type NotificationCategory = z.infer<typeof notificationCategorySchema>;

export const notificationEventTypes = [
  "deployment.queued",
  "deployment.started",
  "deployment.succeeded",
  "deployment.failed",
  "deployment.cancelled",
  "deployment.circuit_open",
  "preview.ready",
  "preview.failed",
  "preview.superseded",
  "preview.cleaned_up",
  "runtime.unhealthy",
  "runtime.recovered",
  "backup.stale",
  "backup.failed",
  "restore.started",
  "restore.succeeded",
  "restore.failed",
  "restore.rolled_back",
  "notification.test",
] as const;
export const notificationEventTypeSchema = z.enum(notificationEventTypes);
export type NotificationEventType = z.infer<typeof notificationEventTypeSchema>;

export const notificationDeliveryStates = [
  "pending",
  "delivering",
  "retrying",
  "succeeded",
  "failed",
] as const;
export const notificationDeliveryStateSchema = z.enum(
  notificationDeliveryStates,
);
export type NotificationDeliveryState = z.infer<
  typeof notificationDeliveryStateSchema
>;

export const notificationAttemptStates = [
  "running",
  "succeeded",
  "retryable_failure",
  "terminal_failure",
] as const;
export const notificationAttemptStateSchema = z.enum(notificationAttemptStates);

const notificationDetailValueSchema = z.union([
  z.boolean(),
  z.number().finite(),
  z.string().max(1_000),
  z.null(),
]);

export const notificationEventPayloadSchema = z
  .object({
    details: z.record(z.string().max(80), notificationDetailValueSchema),
    entity: z
      .object({
        id: z.string().max(255),
        kind: z.enum([
          "deployment",
          "preview",
          "server",
          "app",
          "resource",
          "backup",
          "restore",
          "source",
          "notification",
        ]),
        name: z.string().max(255),
      })
      .strict(),
    message: z.string().max(2_000),
    occurredAt: z.string().datetime(),
    source: z
      .object({
        id: z.string().uuid(),
        name: z.string().max(255),
      })
      .strict(),
    title: z.string().max(255),
  })
  .strict();
export type NotificationEventPayload = z.infer<
  typeof notificationEventPayloadSchema
>;

const notificationDestinationBaseSchema = z.object({
  categories: z.array(notificationCategorySchema).min(1).max(5),
  enabled: z.boolean(),
});

export const slackNotificationConfigSchema = z
  .object({
    channelId: z
      .string()
      .trim()
      .regex(/^[A-Z][A-Z0-9]{1,79}$/u, "Enter a valid Slack channel ID"),
  })
  .strict();

export const smtpNotificationConfigSchema = z
  .object({
    recipients: z.array(z.string().email().max(320)).min(1).max(20),
  })
  .strict();

export const notificationDestinationInputSchema = z.discriminatedUnion(
  "provider",
  [
    notificationDestinationBaseSchema
      .extend({
        config: slackNotificationConfigSchema,
        provider: z.literal("slack"),
      })
      .strict(),
    notificationDestinationBaseSchema
      .extend({
        config: smtpNotificationConfigSchema,
        provider: z.literal("smtp"),
      })
      .strict(),
  ],
);
export type NotificationDestinationInput = z.infer<
  typeof notificationDestinationInputSchema
>;

export function notificationCategoryForEvent(
  type: NotificationEventType,
): NotificationCategory | "test" {
  if (type.startsWith("deployment.")) return "deployments";
  if (type.startsWith("preview.")) return "previews";
  if (type.startsWith("runtime.")) return "health";
  if (type.startsWith("backup.")) return "backups";
  if (type.startsWith("restore.")) return "restores";
  return "test";
}
