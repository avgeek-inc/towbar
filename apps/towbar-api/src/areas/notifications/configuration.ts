import { z } from "zod";
import { getEnv } from "../../env.js";
import { readSecretMetadata, readSecretValues } from "../secrets/store.js";
import type { NotificationProvider } from "@workspace/towbar-core";

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

export const slackSettingsSchema = z
  .object({ botToken: z.string().min(1).max(4096) })
  .strict();
export const smtpSettingsSchema = z
  .object({
    host: z.string().trim().min(1).max(253),
    from: z.string().email().max(320),
    port: z
      .string()
      .regex(/^\d+$/u)
      .refine((value) => Number(value) > 0 && Number(value) <= 65535)
      .optional(),
    secure: z.enum(["true", "false"]).optional(),
    username: z.string().min(1).max(320).optional(),
    password: z.string().min(1).max(4096).optional(),
    subjectPrefix: z
      .string()
      .max(80)
      .refine((value) => !/[\r\n]/u.test(value))
      .optional(),
  })
  .strict();

export async function notificationProviderAvailability(workspaceId: string) {
  const [slack, smtp] = await Promise.all(
    (["slack", "smtp"] as const).map((stage) =>
      readSecretMetadata({
        type: "notifications",
        workspaceId,
        environment: "production",
        stage,
      }),
    ),
  );
  return {
    slack: slack!.keys.includes("botToken"),
    smtp: smtp!.keys.includes("host") && smtp!.keys.includes("from"),
  };
}

export async function getNotificationProviderConfiguration(
  provider: NotificationProvider,
  workspaceId: string,
): Promise<NotificationProviderConfiguration | null> {
  const { values } = await readSecretValues({
    type: "notifications",
    workspaceId,
    environment: "production",
    stage: provider,
  });
  if (provider === "slack") {
    const result = slackSettingsSchema.safeParse(values);
    return result.success
      ? { ...result.data, appBaseUrl: getEnv().TOWBAR_APP_BASE_URL, provider }
      : null;
  }
  const result = smtpSettingsSchema.safeParse(values);
  if (!result.success) return null;
  return {
    ...result.data,
    provider,
    port: Number(result.data.port ?? 587),
    secure: result.data.secure === "true",
    subjectPrefix: result.data.subjectPrefix ?? "Towbar",
  };
}
