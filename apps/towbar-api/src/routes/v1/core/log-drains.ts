import { Hono } from "hono";
import { z } from "zod";

import {
  getServerLogDrainUsage,
  listLogDrains,
} from "../../../areas/log-drains/service.js";
import { badRequest } from "../../../http/errors.js";
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
logDrainRoutes.get(
  "/usage/:serverId",
  operation({
    permissions: ["server.read"],
    browserOnly: true,
    summary: "Get log forwarding delivery health for one server",
    responseSchema: 'log-drains.ts:get:"/usage/:serverId"',
    response:
      "Current provider names and server delivery counters, without credentials.",
    status: 200,
  }),
  async (context) => {
    const parsed = z.uuid().safeParse(context.req.param("serverId"));
    if (!parsed.success) throw badRequest("Invalid server ID");
    return context.json(
      await getServerLogDrainUsage(
        context.get("user").workspaceId,
        parsed.data,
      ),
    );
  },
);
