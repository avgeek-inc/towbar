import { getEnv } from "../../env.js";

import type { NotificationProvider } from "@workspace/towbar-core";

export type SlackProviderConfiguration = {
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
          botToken: env.TOWBAR_SLACK_BOT_TOKEN,
          provider: "slack",
        }
      : null;
  }
  return env.TOWBAR_SMTP_HOST && env.TOWBAR_SMTP_FROM
    ? {
        from: env.TOWBAR_SMTP_FROM,
        host: env.TOWBAR_SMTP_HOST,
        password: env.TOWBAR_SMTP_PASSWORD,
        port: env.TOWBAR_SMTP_PORT,
        provider: "smtp",
        secure: env.TOWBAR_SMTP_SECURE,
        subjectPrefix: env.TOWBAR_SMTP_SUBJECT_PREFIX,
        username: env.TOWBAR_SMTP_USERNAME,
      }
    : null;
}
