import { Hono } from "hono";
import { z } from "zod";
import { executeTransactionalEmail } from "../../../areas/team/email-delivery.js";
export const internalTransactionalEmailRoutes = new Hono();
internalTransactionalEmailRoutes.post("/:outboxId/deliver", async (context) =>
  context.json(
    await executeTransactionalEmail(
      z.uuid().parse(context.req.param("outboxId")),
    ),
  ),
);
