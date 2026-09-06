import { Hono } from "hono";
import { monitoringSampleSchema } from "@workspace/towbar-core";
import {
  authenticateAgent,
  ingestMonitoringSample,
} from "../../areas/monitoring/ingest.js";
import { HttpError, unauthorized } from "../../http/errors.js";
import { readJson, readUuidPathParameter } from "../../http/requests.js";
import {
  getClientAddress,
  incrementPersistentBucket,
} from "../../http/rate-limit.js";

export const monitoringIngestRoutes = new Hono();
monitoringIngestRoutes.post("/metrics", async (context) => {
  const now = new Date();
  // Separate from user API/MCP quotas. Allows multiple agents behind one NAT.
  const window = await incrementPersistentBucket(
    `monitoring-address:${getClientAddress(context)}`,
    now,
    60_000,
  );
  if (window.attempts > 600)
    throw new HttpError(
      429,
      "MONITORING_RATE_LIMITED",
      "Monitoring upload limit exceeded",
      { responseHeaders: { "Retry-After": "60" } },
    );
  const authorization = context.req.header("authorization") ?? "";
  if (!/^Bearer twma_[a-f0-9]{64}$/u.test(authorization))
    throw unauthorized("A monitoring agent credential is required");
  const serverId = readUuidPathParameter(
    context.req.header("x-towbar-server") ?? "",
    "X-Towbar-Server",
  );
  const generation = await authenticateAgent(serverId, authorization.slice(7));
  const sample = await readJson(context, monitoringSampleSchema, 1024 * 1024);
  return context.json(
    await ingestMonitoringSample(serverId, generation, sample, now),
  );
});
