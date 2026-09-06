import { Hono } from "hono";
import { z } from "zod";
import {
  finishMonitoringOperation,
  getMonitoringExecutionContext,
} from "../../../areas/monitoring/lifecycle.js";
import { readJson, readUuidPathParameter } from "../../../http/requests.js";

export const internalMonitoringRoutes = new Hono();
internalMonitoringRoutes.get("/:serverId/:generation/context", async (c) =>
  c.json({
    context: await getMonitoringExecutionContext(
      readUuidPathParameter(c.req.param("serverId"), "serverId"),
      readUuidPathParameter(c.req.param("generation"), "generation"),
    ),
  }),
);
internalMonitoringRoutes.post("/:serverId/:generation/complete", async (c) => {
  const body = await readJson(c, z.object({ succeeded: z.boolean() }).strict());
  await finishMonitoringOperation(
    readUuidPathParameter(c.req.param("serverId"), "serverId"),
    readUuidPathParameter(c.req.param("generation"), "generation"),
    body.succeeded,
  );
  return c.json({ ok: true });
});
