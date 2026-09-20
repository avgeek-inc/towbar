import { z } from "zod";
import { Hono } from "hono";

import { getNotificationProviderState } from "../../../areas/notifications/configuration.js";
import { listNotificationEvents } from "../../../areas/notifications/service.js";
import { operation } from "../../../http/operation.js";

import type { TowbarHonoEnvironment } from "../../../http/types.js";

export const notificationCenterRoutes = new Hono<TowbarHonoEnvironment>();

notificationCenterRoutes.get(
  "/providers",
  operation({
    permissions: ["notification.manage"],
    browserOnly: true,
    responseSchema: 'notification-center.ts:get:"/providers"',
    summary: "Get environment-configured notification providers",
    response: "Configured providers without environment values or secrets.",
    status: 200,
  }),
  async (context) => {
    context.header("Cache-Control", "no-store");
    return context.json(
      await getNotificationProviderState(context.get("user").workspaceId),
    );
  },
);

notificationCenterRoutes.get(
  "/",
  operation({
    permissions: ["inbox.read"],
    browserOnly: true,
    responseSchema: 'notification-center.ts:get:"/"',
    summary: "List notification events",
    query: z
      .object({ limit: z.coerce.number().int().min(1).max(100).optional() })
      .strict(),
    response: "JSON object containing notifications.",
    status: 200,
  }),
  async (context) => {
    const requestedLimit = Number(context.req.query("limit") ?? 20);
    return context.json({
      notifications: await listNotificationEvents({
        limit: Number.isInteger(requestedLimit)
          ? Math.min(100, Math.max(1, requestedLimit))
          : 20,
        workspaceId: context.get("user").workspaceId,
      }),
    });
  },
);
