import type { NotificationProvider } from "@workspace/towbar-core";

import { getEnv } from "../../env.js";

export type SlackProviderConfiguration = {
  appBaseUrl: string;
  botToken: string;
  provider: "slack";
};
export type SmtpProviderConfiguration = {
  from: string;
  host: string;
  password?: string;
  port: number;
  provider: "smtp";
  secure: boolean;
  subjectPrefix: string;
  username?: string;
};
export type NotificationProviderConfiguration =
  SlackProviderConfiguration | SmtpProviderConfiguration;

export function notificationProviderAvailability() {
  const env = getEnv();
  return {
    slack: Boolean(env.TOWBAR_SLACK_BOT_TOKEN),
    smtp: Boolean(env.TOWBAR_SMTP_HOST && env.TOWBAR_SMTP_FROM),
  };
}

export function getNotificationProviderConfiguration(
  provider: NotificationProvider,
): NotificationProviderConfiguration | null {
  const env = getEnv();
  if (provider === "slack") {
    return env.TOWBAR_SLACK_BOT_TOKEN
      ? {
          appBaseUrl: env.TOWBAR_APP_BASE_URL,
          botToken: env.TOWBAR_SLACK_BOT_TOKEN,
          provider,
        }
      : null;
  }
  if (!env.TOWBAR_SMTP_HOST || !env.TOWBAR_SMTP_FROM) return null;
  return {
    from: env.TOWBAR_SMTP_FROM,
    host: env.TOWBAR_SMTP_HOST,
    password: env.TOWBAR_SMTP_PASSWORD,
    port: env.TOWBAR_SMTP_PORT ?? 587,
    provider,
    secure: env.TOWBAR_SMTP_SECURE,
    subjectPrefix: env.TOWBAR_SMTP_SUBJECT_PREFIX ?? "Towbar",
    username: env.TOWBAR_SMTP_USERNAME,
  };
}
