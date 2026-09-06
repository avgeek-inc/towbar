import { Hono } from "hono";
import { z } from "zod";

import { runMaintenanceSweep } from "../../../areas/resource-operations/maintenance.js";
import { recordMaintenanceHeartbeat } from "../../../areas/system-health/service.js";
import { collectScoutHttpChecks } from "../../../areas/monitoring/http-checks.js";
import { evaluateScoutAlerts } from "../../../areas/monitoring/alert-evaluator.js";

const heartbeatSchema = z
  .object({ version: z.string().min(1).max(64) })
  .strict();

export const internalMaintenanceRoutes = new Hono();
internalMaintenanceRoutes.post("/scout-alerts", async (context) => {
  const [alerts, http] = await Promise.all([
    evaluateScoutAlerts(),
    collectScoutHttpChecks(),
  ]);
  return context.json({ ...alerts, http });
});

internalMaintenanceRoutes.post("/sweep", async (context) => {
  const body = heartbeatSchema.parse(await context.req.json());
  const result = await runMaintenanceSweep();
  await recordMaintenanceHeartbeat({ details: result, version: body.version });
  return context.json(result);
});
