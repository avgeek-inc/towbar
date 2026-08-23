import { Hono } from "hono";
import { z } from "zod";

import { serverPreparationStepDefinitions } from "@workspace/towbar-core";

import {
  getServerPreparationExecutionContext,
  updateServerPreparation,
} from "../../../areas/servers/preparations.js";
import { readJson } from "../../../http/requests.js";

const stepIds = serverPreparationStepDefinitions.map((step) => step.id) as [
  (typeof serverPreparationStepDefinitions)[number]["id"],
  ...(typeof serverPreparationStepDefinitions)[number]["id"][],
];
const stepSchema = z
  .object({
    finishedAt: z.string().datetime().nullable(),
    id: z.enum(stepIds),
    message: z.string().max(1_000).nullable(),
    startedAt: z.string().datetime().nullable(),
    status: z.enum(["waiting", "running", "succeeded", "failed"]),
    title: z.string().trim().min(1).max(100),
  })
  .strict();
const stepsSchema = z.array(stepSchema).length(stepIds.length);
const eventSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("running"), steps: stepsSchema }).strict(),
  z
    .object({
      result: z.record(z.string(), z.unknown()),
      status: z.literal("succeeded"),
      steps: stepsSchema,
    })
    .strict(),
  z
    .object({
      errorCode: z.string().trim().min(1).max(100),
      errorMessage: z.string().trim().min(1).max(1_000),
      status: z.literal("failed"),
      steps: stepsSchema,
    })
    .strict(),
]);

export const internalServerPreparationRoutes = new Hono();

internalServerPreparationRoutes.get(
  "/:preparationId/context",
  async (context) =>
    context.json({
      context: await getServerPreparationExecutionContext(
        context.req.param("preparationId"),
      ),
    }),
);
internalServerPreparationRoutes.post(
  "/:preparationId/events",
  async (context) => {
    const body = await readJson(context, eventSchema);
    return context.json({
      preparation: await updateServerPreparation(
        context.req.param("preparationId"),
        body,
      ),
    });
  },
);
