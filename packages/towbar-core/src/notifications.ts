import { z } from "zod";

export const notificationProviders = [
  "slack",
  "smtp",
  "discord",
  "telegram",
  "webhook",
] as const;
export const notificationProviderSchema = z.enum(notificationProviders);
export type NotificationProvider = z.infer<typeof notificationProviderSchema>;

export const notificationCategories = [
  "deployments",
  "health",
  "backups",
  "restores",
  "scout",
] as const;
export const notificationCategorySchema = z.enum(notificationCategories);
export type NotificationCategory = z.infer<typeof notificationCategorySchema>;

export const notificationEventTypes = [
  "deployment.queued",
  "deployment.started",
  "deployment.succeeded",
  "deployment.failed",
  "deployment.cancelled",
  "preview.ready",
  "preview.failed",
  "preview.superseded",
  "preview.cleaned_up",
  "runtime.unhealthy",
  "runtime.recovered",
  "log-drain.auth_failure",
  "log-drain.pipeline_failed",
  "log-drain.pipeline_recovered",
  "log-drain.rate_limited",
  "server.maintenance.succeeded",
  "server.maintenance.failed",
  "backup.stale",
  "backup.failed",
  "backup.not_restorable",
  "restore.started",
  "restore.succeeded",
  "restore.cancelled",
  "restore.failed",
  "restore.rolled_back",
  "scout.firing",
  "scout.recovered",
  "scout.reminder",
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
      .strict()
      .nullable(),
    title: z.string().max(255),
  })
  .strict();
export type NotificationEventPayload = z.infer<
  typeof notificationEventPayloadSchema
>;

const notificationDestinationBaseSchema = z.object({
  categories: z
    .array(notificationCategorySchema)
    .min(1)
    .max(notificationCategories.length),
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

export const discordWebhookCredentialsSchema = z
  .object({
    webhookId: z
      .string()
      .trim()
      .regex(/^\d{1,20}$/u, "Enter a Discord webhook ID"),
    webhookToken: z
      .string()
      .trim()
      .min(1)
      .max(512)
      .regex(/^[A-Za-z0-9_-]+$/u, "Enter a Discord webhook token"),
  })
  .strict();

const legacyDiscordWebhookUrlSchema = z
  .string()
  .url()
  .max(2_048)
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      ["discord.com", "discordapp.com"].includes(url.hostname) &&
      /^\/api\/webhooks\/\d{1,20}\/[A-Za-z0-9_-]+$/u.test(url.pathname) &&
      !url.search &&
      !url.hash
    );
  }, "Enter a Discord webhook URL");

export const discordNotificationConfigSchema = z.union([
  discordWebhookCredentialsSchema,
  z
    .object({ webhookUrl: legacyDiscordWebhookUrlSchema })
    .strict()
    .transform(({ webhookUrl }) => {
      const [, , , webhookId, webhookToken] = new URL(
        webhookUrl,
      ).pathname.split("/");
      return discordWebhookCredentialsSchema.parse({ webhookId, webhookToken });
    }),
]);

export const telegramNotificationConfigSchema = z
  .object({
    chatId: z
      .string()
      .trim()
      .regex(/^-?\d{1,20}$/u, "Enter a Telegram chat ID")
      .optional(),
    messageThreadId: z.number().int().positive().max(2_147_483_647).optional(),
  })
  .strict();

const manifestSubscriptionSchema = z
  .object({
    deployments: z.boolean(),
    backupsAndRestores: z.boolean(),
    alertsAndIncidents: z.boolean(),
  })
  .refine(
    (value) => Object.values(value).some(Boolean),
    "Enable at least one notification category",
  );

function uniqueDestinations<T>(rows: T[], key: (row: T) => string): boolean {
  return new Set(rows.map(key)).size === rows.length;
}

export const manifestNotificationsSchema = z
  .object({
    email: z
      .array(
        manifestSubscriptionSchema
          .safeExtend({ address: z.string().trim().email().max(320) })
          .strict(),
      )
      .max(100)
      .refine(
        (rows) => uniqueDestinations(rows, (row) => row.address.toLowerCase()),
        "Each email address can appear only once",
      )
      .optional(),
    slack: z
      .array(
        manifestSubscriptionSchema
          .safeExtend({
            channelId: slackNotificationConfigSchema.shape.channelId,
          })
          .strict(),
      )
      .max(100)
      .refine(
        (rows) => uniqueDestinations(rows, (row) => row.channelId),
        "Each Slack channel can appear only once",
      )
      .optional(),
    discord: z
      .array(
        manifestSubscriptionSchema
          .safeExtend({
            webhookId: discordWebhookCredentialsSchema.shape.webhookId,
          })
          .strict(),
      )
      .max(100)
      .refine(
        (rows) => uniqueDestinations(rows, (row) => row.webhookId),
        "Each Discord webhook ID can appear only once",
      )
      .optional(),
    telegram: z
      .array(
        manifestSubscriptionSchema
          .safeExtend({
            chatId: telegramNotificationConfigSchema.shape.chatId.unwrap(),
            messageThreadId:
              telegramNotificationConfigSchema.shape.messageThreadId.optional(),
          })
          .strict(),
      )
      .max(100)
      .refine(
        (rows) =>
          uniqueDestinations(
            rows,
            (row) => `${row.chatId}:${row.messageThreadId ?? 0}`,
          ),
        "Each Telegram chat and topic can appear only once",
      )
      .optional(),
  })
  .strict()
  .refine(
    (value) =>
      Object.values(value).reduce(
        (total, rows) => total + (rows?.length ?? 0),
        0,
      ) <= 100,
    "At most 100 notification destinations are supported per entity",
  );

export type ManifestNotifications = z.infer<typeof manifestNotificationsSchema>;

export function normalizeManifestNotifications(
  value: ManifestNotifications | undefined,
): ManifestNotifications | undefined {
  if (!value) return undefined;
  const normalized = {
    ...(value.email?.length
      ? {
          email: value.email
            .map((row) => ({ ...row, address: row.address.toLowerCase() }))
            .sort((a, b) => a.address.localeCompare(b.address)),
        }
      : {}),
    ...(value.slack?.length
      ? {
          slack: [...value.slack].sort((a, b) =>
            a.channelId.localeCompare(b.channelId),
          ),
        }
      : {}),
    ...(value.discord?.length
      ? {
          discord: [...value.discord].sort((a, b) =>
            a.webhookId.localeCompare(b.webhookId),
          ),
        }
      : {}),
    ...(value.telegram?.length
      ? {
          telegram: [...value.telegram].sort(
            (a, b) =>
              a.chatId.localeCompare(b.chatId) ||
              (a.messageThreadId ?? 0) - (b.messageThreadId ?? 0),
          ),
        }
      : {}),
  };
  return Object.keys(normalized).length ? normalized : undefined;
}

export const webhookNotificationConfigSchema = z
  .object({
    url: z
      .string()
      .url()
      .max(2_048)
      .refine((value) => {
        const url = new URL(value);
        return (
          url.protocol === "https:" &&
          !url.username &&
          !url.password &&
          !url.port
        );
      }, "Enter a public HTTPS URL without credentials or a custom port"),
    headers: z
      .record(
        z.string().regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u),
        z
          .string()
          .max(4_096)
          .refine((value) => !/[\r\n]/u.test(value)),
      )
      .refine((headers) => Object.keys(headers).length <= 20)
      .refine(
        (headers) =>
          Object.keys(headers).every(
            (name) =>
              !/^(?:content-type|content-length|host|connection|transfer-encoding|user-agent|x-towbar-.*)$/iu.test(
                name,
              ),
          ),
        "Reserved delivery headers cannot be overridden",
      )
      .optional(),
    signingSecret: z.string().min(32).max(512).optional(),
    label: z.string().trim().min(1).max(100).optional(),
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
    notificationDestinationBaseSchema
      .extend({
        config: discordNotificationConfigSchema,
        provider: z.literal("discord"),
      })
      .strict(),
    notificationDestinationBaseSchema
      .extend({
        config: telegramNotificationConfigSchema,
        provider: z.literal("telegram"),
      })
      .strict(),
    notificationDestinationBaseSchema
      .extend({
        config: webhookNotificationConfigSchema,
        provider: z.literal("webhook"),
      })
      .strict(),
  ],
);
export type NotificationDestinationInput = z.infer<
  typeof notificationDestinationInputSchema
>;

export const slackConnectionInputSchema = z
  .object({
    botToken: z.string().trim().startsWith("xoxb-").min(20).max(512),
  })
  .strict();

export const slackChannelRoutingInputSchema = z
  .object({
    channels: z
      .array(
        z
          .object({
            category: notificationCategorySchema,
            channelId: slackNotificationConfigSchema.shape.channelId,
          })
          .strict(),
      )
      .max(notificationCategories.length)
      .refine(
        (channels) =>
          new Set(channels.map((channel) => channel.category)).size ===
          channels.length,
        "Configure each notification category once",
      ),
  })
  .strict();
export type SlackChannelRoutingInput = z.infer<
  typeof slackChannelRoutingInputSchema
>;

export const emailConnectionInputSchema = z
  .object({
    from: z.string().email().max(320),
    host: z.string().trim().min(1).max(253),
    password: z.string().max(4_096).optional(),
    port: z.number().int().min(1).max(65_535),
    secure: z.boolean(),
    username: z.string().trim().max(320).optional(),
  })
  .strict();

export const emailRoutingInputSchema = z
  .object({
    routes: z
      .array(
        z
          .object({
            category: notificationCategorySchema,
            recipients: smtpNotificationConfigSchema.shape.recipients,
          })
          .strict(),
      )
      .max(notificationCategories.length)
      .refine(
        (routes) =>
          new Set(routes.map((route) => route.category)).size === routes.length,
        "Configure each notification category once",
      ),
  })
  .strict();

const webhookUrlSchema = webhookNotificationConfigSchema.shape.url;

export const discordRoutingInputSchema = z
  .object({
    routes: uniqueCategoryRoutes(
      z
        .object({
          category: notificationCategorySchema,
          webhookUrl: legacyDiscordWebhookUrlSchema.optional(),
        })
        .strict(),
    ),
  })
  .strict();

export const webhookRoutingInputSchema = z
  .object({
    routes: uniqueCategoryRoutes(
      z
        .object({
          category: notificationCategorySchema,
          url: webhookUrlSchema.optional(),
        })
        .strict(),
    ),
  })
  .strict();

export const telegramConnectionInputSchema = z
  .object({
    botToken: z
      .string()
      .trim()
      .max(256)
      .regex(/^\d{5,20}:[A-Za-z0-9_-]{20,}$/u, "Enter a Telegram bot token")
      .optional(),
    chatId: z
      .string()
      .trim()
      .regex(/^-?\d{1,20}$/u, "Enter a Telegram chat ID")
      .optional(),
  })
  .strict();

export const telegramTopicRoutingInputSchema = z
  .object({
    routes: z
      .array(
        z
          .object({
            category: notificationCategorySchema,
            messageThreadId:
              telegramNotificationConfigSchema.shape.messageThreadId.unwrap(),
          })
          .strict(),
      )
      .max(notificationCategories.length)
      .refine(
        (routes) =>
          new Set(routes.map((route) => route.category)).size === routes.length,
        "Configure each notification category once",
      ),
  })
  .strict();

function uniqueCategoryRoutes<
  T extends z.ZodType<{ category: NotificationCategory }>,
>(routeSchema: T) {
  return z
    .array(routeSchema)
    .max(notificationCategories.length)
    .refine(
      (routes) =>
        new Set(routes.map((route) => route.category)).size === routes.length,
      "Configure each notification category once",
    );
}

export type SlackConnectionInput = z.infer<typeof slackConnectionInputSchema>;
export type EmailConnectionInput = z.infer<typeof emailConnectionInputSchema>;
export type EmailRoutingInput = z.infer<typeof emailRoutingInputSchema>;
export type DiscordRoutingInput = z.infer<typeof discordRoutingInputSchema>;
export type TelegramConnectionInput = z.infer<
  typeof telegramConnectionInputSchema
>;
export type TelegramTopicRoutingInput = z.infer<
  typeof telegramTopicRoutingInputSchema
>;
export type WebhookRoutingInput = z.infer<typeof webhookRoutingInputSchema>;

export function notificationCategoryForEvent(
  type: NotificationEventType,
): NotificationCategory | "test" {
  if (type.startsWith("deployment.")) return "deployments";
  if (type.startsWith("preview.")) return "deployments";
  if (
    type.startsWith("runtime.") ||
    type.startsWith("log-drain.") ||
    type.startsWith("server.maintenance.")
  )
    return "health";
  if (type.startsWith("backup.")) return "backups";
  if (type.startsWith("scout.")) return "scout";
  if (type.startsWith("restore.")) return "restores";
  return "test";
}
