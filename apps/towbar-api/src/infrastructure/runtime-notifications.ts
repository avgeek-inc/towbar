import {
  type EmailConnectionInput,
  type NotificationDestinationInput,
  type NotificationProvider,
  type SlackConnectionInput,
  type TelegramConnectionInput,
  emailConnectionInputSchema,
  notificationDestinationInputSchema,
  slackConnectionInputSchema,
  telegramConnectionInputSchema,
} from "@workspace/towbar-core";
import { z } from "zod";

type RuntimeNotificationProviderConfiguration =
  | (SlackConnectionInput & { appBaseUrl: string; provider: "slack" })
  | (EmailConnectionInput & { provider: "smtp"; subjectPrefix: "Towbar" })
  | (Required<TelegramConnectionInput> & { provider: "telegram" })
  | { provider: "discord" | "webhook" };

type RuntimeNotificationRoute = NotificationDestinationInput & {
  id: string;
};

type RuntimeNotifications = {
  providers: Partial<
    Record<NotificationProvider, RuntimeNotificationProviderConfiguration>
  >;
  routes: RuntimeNotificationRoute[];
};

const routeSchema = z
  .object({
    id: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u)
      .max(64),
  })
  .and(notificationDestinationInputSchema);

const runtimeNotificationsSchema = z
  .object({
    providers: z
      .object({
        slack: slackConnectionInputSchema.optional(),
        smtp: emailConnectionInputSchema.optional(),
        telegram: telegramConnectionInputSchema
          .extend({
            botToken: telegramConnectionInputSchema.shape.botToken.unwrap(),
          })
          .optional(),
      })
      .strict(),
    routes: z.array(routeSchema).max(100),
  })
  .strict()
  .superRefine((value, context) => {
    const ids = new Set<string>();
    for (const [index, route] of value.routes.entries()) {
      if (ids.has(route.id))
        context.addIssue({
          code: "custom",
          message: "Notification route identifiers must be unique",
          path: ["routes", index, "id"],
        });
      ids.add(route.id);
      if (
        route.provider !== "discord" &&
        route.provider !== "webhook" &&
        !value.providers[route.provider]
      )
        context.addIssue({
          code: "custom",
          message: `The ${route.provider} provider is required by this route`,
          path: ["routes", index, "provider"],
        });
    }
  });

let cached: RuntimeNotifications | undefined;

export function getRuntimeNotifications(
  environment: Record<string, string | undefined> = process.env,
): RuntimeNotifications {
  if (environment === process.env && cached) return cached;
  const enabled = environment.TOWBAR_NOTIFICATIONS_ENABLED?.trim();
  if (!enabled || enabled === "false") return { providers: {}, routes: [] };
  if (enabled !== "true")
    throw new Error("TOWBAR_NOTIFICATIONS_ENABLED must be true or false");
  const raw = environment.TOWBAR_NOTIFICATION_CONFIG_JSON?.trim();
  if (!raw)
    throw new Error(
      "TOWBAR_NOTIFICATION_CONFIG_JSON is required when TOWBAR_NOTIFICATIONS_ENABLED=true",
    );
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error("TOWBAR_NOTIFICATION_CONFIG_JSON must contain valid JSON", {
      cause: error,
    });
  }
  const parsed = runtimeNotificationsSchema.parse(value);
  const providers: RuntimeNotifications["providers"] = {
    discord: parsed.routes.some((route) => route.provider === "discord")
      ? { provider: "discord" }
      : undefined,
    webhook: parsed.routes.some((route) => route.provider === "webhook")
      ? { provider: "webhook" }
      : undefined,
    slack: parsed.providers.slack
      ? {
          ...parsed.providers.slack,
          appBaseUrl:
            environment.TOWBAR_APP_BASE_URL ?? "http://localhost:4021",
          provider: "slack",
        }
      : undefined,
    smtp: parsed.providers.smtp
      ? {
          ...parsed.providers.smtp,
          provider: "smtp",
          subjectPrefix: "Towbar",
        }
      : undefined,
    telegram: parsed.providers.telegram
      ? { ...parsed.providers.telegram, provider: "telegram" }
      : undefined,
  };
  const result = {
    providers,
    routes: parsed.routes.filter((route) => route.enabled),
  };
  if (environment === process.env) cached = result;
  return result;
}

export function getRuntimeNotificationRoute(id: string) {
  return (
    getRuntimeNotifications().routes.find((route) => route.id === id) ?? null
  );
}

export function getRuntimeNotificationProvider(provider: NotificationProvider) {
  return getRuntimeNotifications().providers[provider] ?? null;
}
