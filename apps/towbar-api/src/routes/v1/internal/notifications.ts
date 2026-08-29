import { Hono } from "hono";
import { z } from "zod";

import { executeNotificationDeliveryAttempt } from "../../../areas/notifications/delivery-service.js";
import { readJson } from "../../../http/requests.js";

import type { TowbarHonoEnvironment } from "../../../http/types.js";

const attemptSchema = z
  .object({
    attempt: z.number().int().min(1).max(20),
    cycle: z.number().int().min(1).max(1_000_000),
  })
  .strict();

export const internalNotificationRoutes = new Hono<TowbarHonoEnvironment>();

internalNotificationRoutes.post("/:deliveryId/attempt", async (context) => {
  const input = await readJson(context, attemptSchema, 4 * 1_024);
  return context.json(
    await executeNotificationDeliveryAttempt({
      ...input,
      deliveryId: context.req.param("deliveryId"),
    }),
  );
});
