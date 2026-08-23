import { Hono } from "hono";
import { z } from "zod";

import { resourceOperationResultSchema } from "@workspace/towbar-core";

import {
  finishResourceOperation,
  getOperationExecutionContext,
  resolveOperationSecrets,
} from "../../../areas/resource-operations/service.js";
import { readJson, readUuidPathParameter } from "../../../http/requests.js";

const operationId = (value: string) =>
  readUuidPathParameter(value, "operationId");

const eventSchema = z.discriminatedUnion("state", [
  z
    .object({
      result: resourceOperationResultSchema,
      state: z.literal("succeeded"),
    })
    .strict(),
  z
    .object({
      errorCode: z.string().trim().min(1).max(100),
      errorMessage: z.string().trim().min(1).max(1_000),
      state: z.literal("failed"),
    })
    .strict(),
]);

export const internalResourceOperationRoutes = new Hono();

internalResourceOperationRoutes.get("/:operationId/context", async (context) =>
  context.json({
    context: await getOperationExecutionContext(
      operationId(context.req.param("operationId")),
    ),
  }),
);

internalResourceOperationRoutes.post(
  "/:operationId/secrets/resolve",
  async (context) =>
    context.json({
      secrets: await resolveOperationSecrets(
        operationId(context.req.param("operationId")),
      ),
    }),
);

internalResourceOperationRoutes.post(
  "/:operationId/events",
  async (context) => {
    const input = await readJson(context, eventSchema);
    return context.json({
      operation: await finishResourceOperation(
        operationId(context.req.param("operationId")),
        input,
      ),
    });
  },
);
