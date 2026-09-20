import { Hono } from "hono";

import { listLogDrains } from "../../../areas/log-drains/service.js";
import { operation } from "../../../http/operation.js";

import type { TowbarHonoEnvironment } from "../../../http/types.js";

export const logDrainRoutes = new Hono<TowbarHonoEnvironment>();
logDrainRoutes.use("*", async (context, next) => {
  context.header("Cache-Control", "no-store");
  await next();
});
logDrainRoutes.get(
  "/",
  operation({
    permissions: ["integration.manage"],
    browserOnly: true,
    summary: "List environment-configured log forwarding providers",
    responseSchema: 'log-drains.ts:get:"/"',
    response:
      "Configured providers and delivery health without environment values or secrets.",
    status: 200,
  }),
  async (context) =>
    context.json(await listLogDrains(context.get("user").workspaceId)),
);
