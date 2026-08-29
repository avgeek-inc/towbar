import { Hono } from "hono";

import { notificationDestinationInputSchema } from "@workspace/towbar-core";

import {
  createNotificationDestination,
  deleteNotificationDestination,
  listNotificationDeliveries,
  listNotificationDestinations,
  retryNotificationDelivery,
  testNotificationDestination,
  updateNotificationDestination,
} from "../../../areas/notifications/service.js";
import { forbidden } from "../../../http/errors.js";
import { readJson } from "../../../http/requests.js";

import type { TowbarHonoEnvironment } from "../../../http/types.js";

export const notificationRoutes = new Hono<TowbarHonoEnvironment>();

notificationRoutes.get("/destinations", async (context) => {
  const user = context.get("user");
  return context.json({
    canManageNotifications: user.workspaceRole === "owner",
    destinations: await listNotificationDestinations({
      sourceId: context.req.param("sourceId")!,
      workspaceId: user.workspaceId,
    }),
  });
});

notificationRoutes.post("/destinations", async (context) => {
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
});

notificationRoutes.put("/destinations/:destinationId", async (context) => {
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
});

notificationRoutes.delete("/destinations/:destinationId", async (context) => {
  requireOwner(context.get("user").workspaceRole);
  const user = context.get("user");
  await deleteNotificationDestination({
    destinationId: context.req.param("destinationId"),
    sourceId: context.req.param("sourceId")!,
    workspaceId: user.workspaceId,
  });
  return context.body(null, 204);
});

notificationRoutes.post(
  "/destinations/:destinationId/actions/test",
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

notificationRoutes.get("/deliveries", async (context) => {
  const user = context.get("user");
  const requestedLimit = Number(context.req.query("limit") ?? 100);
  return context.json({
    deliveries: await listNotificationDeliveries({
      limit: Number.isInteger(requestedLimit)
        ? Math.max(1, requestedLimit)
        : 100,
      sourceId: context.req.param("sourceId")!,
      workspaceId: user.workspaceId,
    }),
  });
});

notificationRoutes.post(
  "/deliveries/:deliveryId/actions/retry",
  async (context) => {
    requireOwner(context.get("user").workspaceRole);
    const user = context.get("user");
    const delivery = await retryNotificationDelivery({
      deliveryId: context.req.param("deliveryId"),
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
