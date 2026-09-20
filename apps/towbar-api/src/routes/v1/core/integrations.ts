import { Hono } from "hono";

import { getRuntimeIntegrations } from "../../../infrastructure/runtime-integrations.js";
import { operation } from "../../../http/operation.js";

import type { TowbarHonoEnvironment } from "../../../http/types.js";

export const integrationRoutes = new Hono<TowbarHonoEnvironment>();

integrationRoutes.get(
  "/",
  operation({
    permissions: ["integration.manage"],
    summary: "List environment-configured integrations",
    responseSchema: 'integrations.ts:get:"/"',
    response:
      "Configured integration capabilities. Environment values and secrets are never returned.",
    status: 200,
  }),
  (context) =>
    context.json({
      integrations: getRuntimeIntegrations().capabilities,
    }),
);
