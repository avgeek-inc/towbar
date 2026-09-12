import { sourceConnectionRoutes } from "./source-connection.js";
import { sourceEnvironmentRoutes } from "./source-environments.js";
import { filterSources, sourceFilters } from "@workspace/towbar-core/inventory";
import { operation } from "../../../http/operation.js";
import { Hono } from "hono";

import {
  deleteSource,
  getSource,
  getSourceSync,
  listSourceSyncs,
  listSources,
} from "../../../areas/sources/service.js";
import { listApps, listResources } from "../../../areas/apps/service.js";
import { listDeployments } from "../../../areas/deployments/service.js";
import { listSourceCapacity } from "../../../areas/servers/capacity.js";
import { listSourceBackups } from "../../../areas/resource-operations/service.js";
import { listPreviewEnvironments } from "../../../areas/previews/service.js";
import { forbidden } from "../../../http/errors.js";
import { readJson } from "../../../http/requests.js";
import { autoDeployControlPatchSchema } from "./auto-deploy-control-requests.js";
import {
  getSourceAutoDeployControl,
  updateSourceAutoDeployControl,
} from "../../../areas/auto-deploy-controls/service.js";
import { wakeMaintenanceWorkflow } from "../../../infrastructure/temporal.js";

import type { TowbarHonoEnvironment } from "../../../http/types.js";

export const sourceRoutes = new Hono<TowbarHonoEnvironment>();
sourceRoutes.route("/", sourceConnectionRoutes);
sourceRoutes.route("/:sourceId/environments", sourceEnvironmentRoutes);

sourceRoutes.get(
  "/",
  operation({
    responseSchema: 'sources.ts:get:"/"',
    query: sourceFilters,
    summary: "List sources",
    response: "JSON object containing sources.",
    status: 200,
  }),
  async (context) => {
    const result = filterSources(
      await listSources(context.get("user").workspaceId),
      sourceFilters.parse(context.req.query()),
    );
    return context.json({ sources: result.items, counts: result.counts });
  },
);

sourceRoutes.get(
  "/:sourceId",
  operation({
    responseSchema: 'sources.ts:get:"/:sourceId"',
    summary: "Get source",
    response: "JSON object containing canManageSource, source.",
    status: 200,
  }),
  async (context) => {
    const user = context.get("user");
    return context.json({
      canManageSource: user.workspaceRole === "owner",
      source: await getSource(context.req.param("sourceId"), user.workspaceId),
    });
  },
);

sourceRoutes.get(
  "/:sourceId/auto-deploy-control",
  operation({
    responseSchema: 'sources.ts:get:"/:sourceId/auto-deploy-control"',
    summary: "Get source auto deploy control",
    response: "JSON object containing autoDeploy, canManageAutoDeploy.",
    status: 200,
  }),
  async (context) => {
    const user = context.get("user");
    return context.json({
      autoDeploy: await getSourceAutoDeployControl(
        context.req.param("sourceId"),
        user.workspaceId,
      ),
      canManageAutoDeploy: user.workspaceRole === "owner",
    });
  },
);

sourceRoutes.patch(
  "/:sourceId/auto-deploy-control",
  operation({
    responseSchema: 'sources.ts:patch:"/:sourceId/auto-deploy-control"',
    summary: "Update source auto deploy control",
    body: autoDeployControlPatchSchema,
    ownerOnly: true,
    response: "JSON object containing autoDeploy, canManageAutoDeploy.",
    status: 200,
  }),
  async (context) => {
    const user = context.get("user");
    if (user.workspaceRole !== "owner") {
      throw forbidden(
        "Only the owner can manage automatic deployment controls",
      );
    }
    const sourceId = context.req.param("sourceId");
    const result = await updateSourceAutoDeployControl({
      ...(await readJson(context, autoDeployControlPatchSchema)),
      sourceId,
      workspaceId: user.workspaceId,
    });
    const { shouldReevaluate, ...autoDeploy } = result;
    if (shouldReevaluate) {
      void wakeMaintenanceWorkflow().catch(() => undefined);
    }
    return context.json({
      autoDeploy,
      canManageAutoDeploy: user.workspaceRole === "owner",
    });
  },
);

sourceRoutes.get(
  "/:sourceId/apps",
  operation({
    responseSchema: 'sources.ts:get:"/:sourceId/apps"',
    summary: "List source apps",
    response: "JSON object containing apps.",
    status: 200,
  }),
  async (context) => {
    const user = context.get("user");
    await getSource(context.req.param("sourceId"), user.workspaceId);
    return context.json({
      apps: await listApps(user.workspaceId, context.req.param("sourceId")),
    });
  },
);

sourceRoutes.get(
  "/:sourceId/resources",
  operation({
    responseSchema: 'sources.ts:get:"/:sourceId/resources"',
    summary: "List source resources",
    response: "JSON object containing resources.",
    status: 200,
  }),
  async (context) => {
    const user = context.get("user");
    await getSource(context.req.param("sourceId"), user.workspaceId);
    return context.json({
      resources: await listResources(
        user.workspaceId,
        context.req.param("sourceId"),
      ),
    });
  },
);

sourceRoutes.get(
  "/:sourceId/capacity",
  operation({
    responseSchema: 'sources.ts:get:"/:sourceId/capacity"',
    summary: "List source capacity",
    response: "JSON object containing capacities.",
    status: 200,
  }),
  async (context) => {
    const user = context.get("user");
    const sourceId = context.req.param("sourceId");
    await getSource(sourceId, user.workspaceId);
    return context.json({
      capacities: await listSourceCapacity(user.workspaceId, sourceId),
    });
  },
);

sourceRoutes.get(
  "/:sourceId/deployments",
  operation({
    responseSchema: 'sources.ts:get:"/:sourceId/deployments"',
    summary: "List source deployments",
    response: "JSON object containing deployments.",
    status: 200,
  }),
  async (context) => {
    const user = context.get("user");
    await getSource(context.req.param("sourceId"), user.workspaceId);
    return context.json({
      deployments: await listDeployments(
        user.workspaceId,
        context.req.param("sourceId"),
      ),
    });
  },
);

sourceRoutes.get(
  "/:sourceId/backups",
  operation({
    responseSchema: 'sources.ts:get:"/:sourceId/backups"',
    summary: "List source backups",
    response: "JSON object containing backups.",
    status: 200,
  }),
  async (context) => {
    const user = context.get("user");
    await getSource(context.req.param("sourceId"), user.workspaceId);
    return context.json({
      backups: await listSourceBackups(
        context.req.param("sourceId"),
        user.workspaceId,
      ),
    });
  },
);

sourceRoutes.get(
  "/:sourceId/previews",
  operation({
    responseSchema: 'sources.ts:get:"/:sourceId/previews"',
    summary: "List source previews",
    response: "JSON object containing previews.",
    status: 200,
  }),
  async (context) => {
    const user = context.get("user");
    await getSource(context.req.param("sourceId"), user.workspaceId);
    return context.json({
      previews: await listPreviewEnvironments({
        sourceId: context.req.param("sourceId"),
        workspaceId: user.workspaceId,
      }),
    });
  },
);

sourceRoutes.delete(
  "/:sourceId",
  operation({
    responseSchema: 'sources.ts:delete:"/:sourceId"',
    summary: "Delete source",
    ownerOnly: true,
    response: "No response body.",
    status: 204,
  }),
  async (context) => {
    const user = context.get("user");
    if (user.workspaceRole !== "owner") {
      throw forbidden("Only administrators can delete Sources");
    }
    await deleteSource(context.req.param("sourceId"), user.workspaceId);
    return context.body(null, 204);
  },
);

sourceRoutes.get(
  "/:sourceId/syncs",
  operation({
    responseSchema: 'sources.ts:get:"/:sourceId/syncs"',
    summary: "List source syncs",
    response: "JSON object containing syncs.",
    status: 200,
  }),
  async (context) =>
    context.json({
      syncs: await listSourceSyncs(
        context.req.param("sourceId"),
        context.get("user").workspaceId,
      ),
    }),
);

sourceRoutes.get(
  "/:sourceId/syncs/:syncId",
  operation({
    responseSchema: 'sources.ts:get:"/:sourceId/syncs/:syncId"',
    summary: "Get source sync",
    response: "JSON object containing sync.",
    status: 200,
  }),
  async (context) =>
    context.json({
      sync: await getSourceSync(
        context.req.param("sourceId"),
        context.req.param("syncId"),
        context.get("user").workspaceId,
      ),
    }),
);
