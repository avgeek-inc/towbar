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
  name: z.string().trim().min(1).max(120),
  secretReference: z.string().trim().min(1).max(1_024),
});

export const slackNotificationConfigSchema = z.object({}).strict();
export const slackNotificationSecretSchema = z
  .object({ webhookUrl: z.string().url().max(2_048) })
  .strict();

export const smtpNotificationConfigSchema = z
  .object({
    from: z.string().email().max(320),
    host: z.string().trim().min(1).max(253),
    port: z.number().int().min(1).max(65_535),
    recipients: z.array(z.string().email().max(320)).min(1).max(20),
    secure: z.boolean(),
    subjectPrefix: z
      .string()
      .trim()
      .max(80)
      .refine((value) => !/[\r\n]/u.test(value), "Invalid subject prefix")
      .default("Towbar"),
  })
  .strict();
export const smtpNotificationSecretSchema = z
  .object({
    password: z.string().min(1).max(4_096),
    username: z.string().min(1).max(320),
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
