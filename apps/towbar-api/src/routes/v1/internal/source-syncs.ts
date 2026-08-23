import { Hono } from "hono";

import { scheduleSourcePushDeployments } from "../../../areas/apps/automatic-deployments.js";
import { executeSourceSync } from "../../../areas/sources/service.js";
import { readUuidPathParameter } from "../../../http/requests.js";

const syncId = (value: string) => readUuidPathParameter(value, "syncId");

export const internalSourceSyncRoutes = new Hono();

internalSourceSyncRoutes.post("/:syncId/execute", async (context) =>
  context.json({
    sync: await executeSourceSync(syncId(context.req.param("syncId"))),
  }),
);

internalSourceSyncRoutes.post("/:syncId/auto-deploy", async (context) =>
  context.json(
    await scheduleSourcePushDeployments(syncId(context.req.param("syncId"))),
  ),
);
