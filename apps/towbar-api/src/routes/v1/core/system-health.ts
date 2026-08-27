import { Hono } from "hono";

import {
  getSystemHealth,
  runSystemHealthChecks,
} from "../../../areas/system-health/service.js";

import type { TowbarHonoEnvironment } from "../../../http/types.js";

export const systemHealthRoutes = new Hono<TowbarHonoEnvironment>();

systemHealthRoutes.get("/", async (context) =>
  context.json(await getSystemHealth(context.get("user").workspaceId)),
);

systemHealthRoutes.post("/actions/check", async (context) =>
  context.json(await runSystemHealthChecks(context.get("user").workspaceId)),
);
