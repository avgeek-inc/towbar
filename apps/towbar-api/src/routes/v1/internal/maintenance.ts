import { Hono } from "hono";

import { runMaintenanceSweep } from "../../../areas/resource-operations/maintenance.js";

export const internalMaintenanceRoutes = new Hono();

internalMaintenanceRoutes.post("/sweep", async (context) =>
  context.json(await runMaintenanceSweep()),
);
