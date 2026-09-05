import { Hono } from "hono";

import { notificationProviderAvailability } from "../../../areas/notifications/configuration.js";
import { listNotificationEvents } from "../../../areas/notifications/service.js";

import type { TowbarHonoEnvironment } from "../../../http/types.js";

export const notificationCenterRoutes = new Hono<TowbarHonoEnvironment>();

notificationCenterRoutes.get("/providers", (context) => {
  context.header("Cache-Control", "no-store");
  return context.json({ providers: notificationProviderAvailability() });
});

notificationCenterRoutes.get("/", async (context) => {
  const requestedLimit = Number(context.req.query("limit") ?? 20);
  return context.json({
    notifications: await listNotificationEvents({
      limit: Number.isInteger(requestedLimit)
        ? Math.min(100, Math.max(1, requestedLimit))
        : 20,
      workspaceId: context.get("user").workspaceId,
    }),
  });
});
