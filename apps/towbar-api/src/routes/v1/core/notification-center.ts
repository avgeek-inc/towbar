import { z } from "zod";
import { operation } from "../../../http/operation.js";
import { Hono } from "hono";

import { notificationProviderAvailability } from "../../../areas/notifications/configuration.js";
import { listNotificationEvents } from "../../../areas/notifications/service.js";

import type { TowbarHonoEnvironment } from "../../../http/types.js";

export const notificationCenterRoutes = new Hono<TowbarHonoEnvironment>();

notificationCenterRoutes.get(
  "/providers",
  operation({
    responseSchema: 'notification-center.ts:get:"/providers"',
    summary: "Get notification provider availability",
    response: "JSON object containing providers.",
    status: 200,
  }),
  (context) => {
    context.header("Cache-Control", "no-store");
    return context.json({ providers: notificationProviderAvailability() });
  },
);

notificationCenterRoutes.get(
  "/",
  operation({
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
