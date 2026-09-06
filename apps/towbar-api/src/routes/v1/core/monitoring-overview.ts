import { Hono } from "hono";
import {
  listMonitoringEntities,
  listWorkspaceAlerts,
  listWorkspaceIncidents,
  monitoringEntitiesQuery,
  monitoringOverviewQuery,
} from "../../../areas/monitoring/workspace.js";
import { operation } from "../../../http/operation.js";
import type { TowbarHonoEnvironment } from "../../../http/types.js";

export const monitoringOverviewRoutes = new Hono<TowbarHonoEnvironment>();
monitoringOverviewRoutes.get(
  "/entities",
  operation({
    responseSchema: 'monitoring-overview.ts:get:"/entities"',
    summary: "List monitoring entities",
    query: monitoringEntitiesQuery,
    response:
      "Searchable, paginated servers, apps, and resources in the current workspace.",
    status: 200,
  }),
  async (context) =>
    context.json(
      await listMonitoringEntities(
        context.get("user").workspaceId,
        monitoringEntitiesQuery.parse(context.req.query()),
      ),
    ),
);
monitoringOverviewRoutes.get(
  "/alerts",
  operation({
    responseSchema: 'monitoring-overview.ts:get:"/alerts"',
    summary: "List workspace Scout alerts",
    query: monitoringOverviewQuery,
    response:
      "Read-only paginated overview of configured rules with their server and workload identity.",
    status: 200,
  }),
  async (context) =>
    context.json(
      await listWorkspaceAlerts(
        context.get("user").workspaceId,
        monitoringOverviewQuery.parse(context.req.query()),
      ),
    ),
);
monitoringOverviewRoutes.get(
  "/incidents",
  operation({
    responseSchema: 'monitoring-overview.ts:get:"/incidents"',
    summary: "List workspace Scout incidents",
    query: monitoringOverviewQuery,
    response:
      "Paginated active and resolved incidents across the current workspace. Inspect details through the server incident route.",
    status: 200,
  }),
  async (context) =>
    context.json(
      await listWorkspaceIncidents(
        context.get("user").workspaceId,
        monitoringOverviewQuery.parse(context.req.query()),
      ),
    ),
);
