import { operation } from "../../../http/operation.js";
import { Hono } from "hono";

import { notificationDestinationInputSchema } from "@workspace/towbar-core";

import {
  createNotificationDestination,
  deleteNotificationDestination,
  listNotificationDestinations,
  testNotificationDestination,
  updateNotificationDestination,
} from "../../../areas/notifications/service.js";
import { notificationProviderAvailability } from "../../../areas/notifications/configuration.js";
import { forbidden } from "../../../http/errors.js";
import { readJson } from "../../../http/requests.js";

import type { TowbarHonoEnvironment } from "../../../http/types.js";

export const notificationRoutes = new Hono<TowbarHonoEnvironment>();

notificationRoutes.get(
  "/destinations",
  operation({
    responseSchema: 'notifications.ts:get:"/destinations"',
    summary: "List notification destinations",
    response:
      "JSON object containing canManageNotifications, destinations, providers.",
    status: 200,
  }),
  async (context) => {
    const user = context.get("user");
    return context.json({
      canManageNotifications: user.workspaceRole === "owner",
      destinations: await listNotificationDestinations({
        sourceId: context.req.param("sourceId")!,
        workspaceId: user.workspaceId,
      }),
      providers: notificationProviderAvailability(),
    });
  },
);

notificationRoutes.post(
  "/destinations",
  operation({
    responseSchema: 'notifications.ts:post:"/destinations"',
    summary: "Create notification destination",
    body: notificationDestinationInputSchema,
    ownerOnly: true,
    response: "JSON object containing destination.",
    status: 201,
  }),
  async (context) => {
    requireOwner(context.get("user").workspaceRole);
    const user = context.get("user");
    const destination = await createNotificationDestination({
      destination: await readJson(
        context,
        notificationDestinationInputSchema,
        32 * 1_024,
      ),
      sourceId: context.req.param("sourceId")!,
      workspaceId: user.workspaceId,
    });
    return context.json({ destination }, 201);
  },
);

notificationRoutes.put(
  "/destinations/:destinationId",
  operation({
    responseSchema: 'notifications.ts:put:"/destinations/:destinationId"',
    summary: "Update notification destination",
    body: notificationDestinationInputSchema,
    ownerOnly: true,
    response: "JSON object containing destination.",
    status: 200,
  }),
  async (context) => {
    requireOwner(context.get("user").workspaceRole);
    const user = context.get("user");
    return context.json({
      destination: await updateNotificationDestination({
        destination: await readJson(
          context,
          notificationDestinationInputSchema,
          32 * 1_024,
        ),
        destinationId: context.req.param("destinationId"),
        sourceId: context.req.param("sourceId")!,
        workspaceId: user.workspaceId,
      }),
    });
  },
);

notificationRoutes.delete(
  "/destinations/:destinationId",
  operation({
    responseSchema: 'notifications.ts:delete:"/destinations/:destinationId"',
    summary: "Delete notification destination",
    ownerOnly: true,
    response: "No response body.",
    status: 204,
  }),
  async (context) => {
    requireOwner(context.get("user").workspaceRole);
    const user = context.get("user");
    await deleteNotificationDestination({
      destinationId: context.req.param("destinationId"),
      sourceId: context.req.param("sourceId")!,
      workspaceId: user.workspaceId,
    });
    return context.body(null, 204);
  },
);

notificationRoutes.post(
  "/destinations/:destinationId/actions/test",
  operation({
    responseSchema:
      'notifications.ts:post:"/destinations/:destinationId/actions/test"',
    summary: "Test notification destination",
    ownerOnly: true,
    response: "JSON object containing delivery.",
    status: 202,
  }),
  async (context) => {
    requireOwner(context.get("user").workspaceRole);
    const user = context.get("user");
    const delivery = await testNotificationDestination({
      destinationId: context.req.param("destinationId"),
      sourceId: context.req.param("sourceId")!,
      workspaceId: user.workspaceId,
    });
    return context.json({ delivery }, 202);
  },
);

function requireOwner(role: "member" | "owner") {
  if (role !== "owner") {
    throw forbidden("Only administrators can manage notifications");
  }
}
