import { Hono } from "hono";

import {
  deliveriesQuery,
  listNotificationDeliveries,
} from "../../../areas/event-history/deliveries.js";
import { listNotificationDestinations } from "../../../areas/notifications/service.js";
import { notificationProviderAvailability } from "../../../areas/notifications/configuration.js";
import { operation } from "../../../http/operation.js";

import type { TowbarHonoEnvironment } from "../../../http/types.js";

export const notificationRoutes = new Hono<TowbarHonoEnvironment>();

notificationRoutes.get(
  "/destinations",
  operation({
    permissions: ["notification.manage"],
    browserOnly: true,
    responseSchema: 'notifications.ts:get:"/destinations"',
    summary: "List environment-configured notification routes",
    response: "Configured routes and provider availability without secrets.",
    status: 200,
  }),
  async (context) => {
    const user = context.get("user");
    return context.json({
      canManageNotifications: false,
      destinations: await listNotificationDestinations({
        sourceId: context.req.param("sourceId"),
        serverId: context.req.param("serverId"),
        workspaceId: user.workspaceId,
      }),
      providers: await notificationProviderAvailability(user.workspaceId),
    });
  },
);

notificationRoutes.get(
  "/deliveries",
  operation({
    permissions: ["notification.manage"],
    browserOnly: true,
    query: deliveriesQuery,
    summary: "List notification deliveries",
    responseSchema: 'notifications.ts:get:"/deliveries"',
    response: "Paginated notification deliveries and delivery state.",
  }),
  async (context) => {
    context.header("Cache-Control", "no-store");
    return context.json(
      await listNotificationDeliveries({
        ...deliveriesQuery.parse(context.req.query()),
        workspaceId: context.get("user").workspaceId,
        sourceId: context.req.param("sourceId"),
        serverId: context.req.param("serverId"),
      }),
    );
  },
);
