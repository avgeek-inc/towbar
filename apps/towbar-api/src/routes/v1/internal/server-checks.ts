import { Hono } from "hono";
import { z } from "zod";

import {
  finishServerCheck,
  getServerCheckExecutionContext,
} from "../../../areas/servers/service.js";
import {
  finishServerCredentialVerification,
  getServerCredentialVerificationExecutionContext,
} from "../../../areas/servers/credential-verification.js";
import { readJson, readUuidPathParameter } from "../../../http/requests.js";
import { markServerCheckInterrupted } from "../../../areas/servers/checks.js";

const checkId = (value: string) => readUuidPathParameter(value, "checkId");

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

internalServerCheckRoutes.get("/:checkId/context", async (context) => {
  const id = checkId(context.req.param("checkId"));
  return context.json({
    context:
      (await getServerCredentialVerificationExecutionContext(id)) ??
      (await getServerCheckExecutionContext(id)),
  });
});
internalServerCheckRoutes.post("/:checkId/events", async (context) => {
  const body = await readJson(context, resultSchema);
  const id = checkId(context.req.param("checkId"));
  return context.json({
    check:
      (await finishServerCredentialVerification(id, body)) ??
      (await finishServerCheck(id, body)),
  });
});
internalServerCheckRoutes.post("/:checkId/interrupt", async (context) =>
  context.json({
    check: await markServerCheckInterrupted(
      checkId(context.req.param("checkId")),
    ),
  }),
);
