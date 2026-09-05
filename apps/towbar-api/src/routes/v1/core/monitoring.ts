import { Hono } from "hono";
import {
  monitoringInstallSchema,
  monitoringQuerySchema,
  monitoringSettingsSchema,
} from "@workspace/towbar-core";
import {
  getMonitoringAgent,
  requestMonitoringAgent,
  updateMonitoringRetention,
} from "../../../areas/monitoring/lifecycle.js";
import { getMonitoringHistory } from "../../../areas/monitoring/queries.js";
import { forbidden } from "../../../http/errors.js";
import { operation } from "../../../http/operation.js";
import { readJson } from "../../../http/requests.js";
import type { TowbarHonoEnvironment } from "../../../http/types.js";

export const monitoringSettingsRoutes = new Hono<TowbarHonoEnvironment>();
monitoringSettingsRoutes.get(
  "/",
  operation({
    responseSchema: 'monitoring.ts:get:"/"',
    summary: "Get monitoring agent",
    response: "Agent status, reporting diagnostics, and retention settings.",
    status: 200,
  }),
  async (context) =>
    context.json({
      agent: await getMonitoringAgent(
        context.req.param("serverId")!,
        context.get("user").workspaceId,
      ),
    }),
);
monitoringSettingsRoutes.patch(
  "/",
  operation({
    responseSchema: 'monitoring.ts:patch:"/"',
    summary: "Set monitoring retention",
    body: monitoringSettingsSchema,
    ownerOnly: true,
    response:
      "Updated monitoring settings. Older data expires when retention is shortened.",
    status: 200,
  }),
  async (context) => {
    const user = context.get("user");
    if (user.workspaceRole !== "owner")
      throw forbidden("Only the owner can configure monitoring");
    const body = await readJson(context, monitoringSettingsSchema);
    return context.json({
      agent: await updateMonitoringRetention({
        ...body,
        serverId: context.req.param("serverId")!,
        workspaceId: user.workspaceId,
        requestedBy: user.id,
      }),
    });
  },
);
monitoringSettingsRoutes.post(
  "/actions/install",
  operation({
    responseSchema: 'monitoring.ts:post:"/actions/install"',
    summary: "Install or update monitoring agent",
    body: monitoringInstallSchema,
    ownerOnly: true,
    response:
      "Queues acknowledged installation of the bundled agent version and rotates its credential. Online status requires a received sample.",
    status: 202,
  }),
  async (context) => {
    const user = context.get("user");
    if (user.workspaceRole !== "owner")
      throw forbidden("Only the owner can install monitoring");
    const body = await readJson(context, monitoringInstallSchema);
    return context.json(
      {
        agent: await requestMonitoringAgent({
          ...body,
          serverId: context.req.param("serverId")!,
          workspaceId: user.workspaceId,
          requestedBy: user.id,
          desiredState: "enabled",
        }),
      },
      202,
    );
  },
);
monitoringSettingsRoutes.post(
  "/actions/uninstall",
  operation({
    responseSchema: 'monitoring.ts:post:"/actions/uninstall"',
    summary: "Uninstall monitoring agent",
    ownerOnly: true,
    response:
      "Revokes the upload credential immediately and queues removal of the agent services and local buffer. Stored history follows the retention policy.",
    status: 202,
  }),
  async (context) => {
    const user = context.get("user");
    if (user.workspaceRole !== "owner")
      throw forbidden("Only the owner can uninstall monitoring");
    return context.json(
      {
        agent: await requestMonitoringAgent({
          serverId: context.req.param("serverId")!,
          workspaceId: user.workspaceId,
          requestedBy: user.id,
          desiredState: "disabled",
        }),
      },
      202,
    );
  },
);

export const monitoringHistoryRoutes = new Hono<TowbarHonoEnvironment>();
monitoringHistoryRoutes.get(
  "/servers/:serverId/metrics",
  operation({
    responseSchema: 'monitoring.ts:get:"/servers/:serverId/metrics"',
    summary: "Read server metrics history",
    query: monitoringQuerySchema,
    response:
      "Server metrics by time, preserving sample counts and minimum/maximum values, plus deployment events.",
    status: 200,
  }),
  async (context) =>
    context.json(
      await getMonitoringHistory({
        ...monitoringQuerySchema.parse(context.req.query()),
        serverId: context.req.param("serverId"),
        workspaceId: context.get("user").workspaceId,
      }),
    ),
);
monitoringHistoryRoutes.get(
  "/apps/:appId/metrics",
  operation({
    responseSchema: 'monitoring.ts:get:"/apps/:appId/metrics"',
    summary: "Read app metrics history",
    query: monitoringQuerySchema,
    response:
      "App metrics across container replacements, with production and preview isolation.",
    status: 200,
  }),
  async (context) =>
    context.json(
      await getMonitoringHistory({
        ...monitoringQuerySchema.parse(context.req.query()),
        deployableId: context.req.param("appId"),
        kind: "app",
        workspaceId: context.get("user").workspaceId,
      }),
    ),
);
monitoringHistoryRoutes.get(
  "/resources/:resourceId/metrics",
  operation({
    responseSchema: 'monitoring.ts:get:"/resources/:resourceId/metrics"',
    summary: "Read resource metrics history",
    query: monitoringQuerySchema,
    response:
      "Resource metrics across container replacements, preserving gaps and per-instance peaks.",
    status: 200,
  }),
  async (context) =>
    context.json(
      await getMonitoringHistory({
        ...monitoringQuerySchema.parse(context.req.query()),
        deployableId: context.req.param("resourceId"),
        kind: "resource",
        workspaceId: context.get("user").workspaceId,
      }),
    ),
);
