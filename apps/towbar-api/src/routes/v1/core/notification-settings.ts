import { Hono } from "hono";
import { z } from "zod";
import { secretMutationSchema } from "@workspace/towbar-core";
import {
  mutateSecret,
  readSecretMetadata,
} from "../../../areas/secrets/store.js";
import {
  slackSettingsSchema,
  smtpSettingsSchema,
} from "../../../areas/notifications/configuration.js";
import { forbidden, unprocessable } from "../../../http/errors.js";
import { readJson } from "../../../http/requests.js";
import type { TowbarHonoEnvironment } from "../../../http/types.js";

export const notificationSettingsRoutes = new Hono<TowbarHonoEnvironment>();
notificationSettingsRoutes.use("*", async (context, next) => {
  if (context.get("user").workspaceRole !== "owner")
    throw forbidden("Only the owner can manage notification providers");
  context.header("Cache-Control", "no-store");
  await next();
});
notificationSettingsRoutes.get("/:provider", async (context) => {
  const provider = z
    .enum(["slack", "smtp"])
    .parse(context.req.param("provider"));
  return context.json({
    canManage: true,
    credential: await readSecretMetadata({
      type: "notifications",
      workspaceId: context.get("user").workspaceId,
      environment: "production",
      stage: provider,
    }),
  });
});
notificationSettingsRoutes.patch("/:provider", async (context) => {
  const provider = z
    .enum(["slack", "smtp"])
    .parse(context.req.param("provider"));
  const user = context.get("user");
  return context.json({
    credential: await mutateSecret(
      {
        type: "notifications",
        workspaceId: user.workspaceId,
        environment: "production",
        stage: provider,
      },
      await readJson(context, secretMutationSchema, 64 * 1024),
      user.id,
      (values) => {
        const result = (
          provider === "slack"
            ? slackSettingsSchema.partial()
            : smtpSettingsSchema.partial()
        ).safeParse(values);
        if (!result.success)
          throw unprocessable(
            "Check the notification fields. Use a valid email, host, port, and true or false for secure TLS.",
          );
      },
    ),
  });
});
