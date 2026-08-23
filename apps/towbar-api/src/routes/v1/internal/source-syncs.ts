import { Hono } from "hono";

import { scheduleSourcePushDeployments } from "../../../areas/apps/automatic-deployments.js";
import { executeSourceSync } from "../../../areas/sources/service.js";

export const internalSourceSyncRoutes = new Hono();

internalSourceSyncRoutes.post("/:syncId/execute", async (context) =>
  context.json({
    sync: await executeSourceSync(context.req.param("syncId")),
  }),
);

internalSourceSyncRoutes.post("/:syncId/auto-deploy", async (context) =>
  context.json(
    await scheduleSourcePushDeployments(context.req.param("syncId")),
  ),
);
