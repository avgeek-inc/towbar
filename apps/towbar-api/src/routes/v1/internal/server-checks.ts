import { Hono } from "hono";
import { z } from "zod";

import {
  finishServerCheck,
  getServerCheckExecutionContext,
} from "../../../areas/servers/service.js";
import { readJson } from "../../../http/requests.js";

const resultSchema = z.discriminatedUnion("status", [
  z
    .object({
      result: z.record(z.string(), z.unknown()),
      status: z.literal("succeeded"),
    })
    .strict(),
  z
    .object({
      errorCode: z.string().trim().min(1).max(100),
      errorMessage: z.string().trim().min(1).max(1_000),
      result: z.record(z.string(), z.unknown()).optional(),
      status: z.literal("failed"),
    })
    .strict(),
]);

export const internalServerCheckRoutes = new Hono();

internalServerCheckRoutes.get("/:checkId/context", async (context) =>
  context.json({
    context: await getServerCheckExecutionContext(context.req.param("checkId")),
  }),
);
internalServerCheckRoutes.post("/:checkId/events", async (context) => {
  const body = await readJson(context, resultSchema);
  return context.json({
    check: await finishServerCheck(context.req.param("checkId"), body),
  });
});
