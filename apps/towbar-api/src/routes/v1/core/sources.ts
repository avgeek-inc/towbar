import { Hono } from "hono";
import { z } from "zod";

import {
  createSource,
  deleteSource,
  getSource,
  getSourceManifest,
  getSourceSync,
  listSourceSyncs,
  listSources,
  previewSourceSync,
  requestSourceSync,
} from "../../../areas/sources/service.js";
import { listApps, listResources } from "../../../areas/apps/service.js";
import { listDeployments } from "../../../areas/deployments/service.js";
import { listSourceServers } from "../../../areas/servers/service.js";
import { listSourceBackups } from "../../../areas/resource-operations/service.js";
import { forbidden } from "../../../http/errors.js";
import { readJson } from "../../../http/requests.js";

import type { TowbarHonoEnvironment } from "../../../http/types.js";

const sourceSchema = z
  .object({
    branch: z.string().trim().min(1).max(255),
    githubInstallationId: z.string().uuid(),
    repositoryName: z.string().trim().min(1).max(255),
    repositoryOwner: z.string().trim().min(1).max(255),
  })
  .strict();

export const sourceRoutes = new Hono<TowbarHonoEnvironment>();

sourceRoutes.get("/", async (context) =>
  context.json({
    sources: await listSources(context.get("user").workspaceId),
  }),
);

sourceRoutes.post("/", async (context) => {
  const input = await readJson(context, sourceSchema);
  const source = await createSource({
    ...input,
    workspaceId: context.get("user").workspaceId,
  });
  return context.json({ source }, 201);
});

sourceRoutes.get("/:sourceId", async (context) => {
  const user = context.get("user");
  return context.json({
    canManageSource: user.workspaceRole === "owner",
    source: await getSource(context.req.param("sourceId"), user.workspaceId),
  });
});

sourceRoutes.get("/:sourceId/apps", async (context) => {
  const user = context.get("user");
  await getSource(context.req.param("sourceId"), user.workspaceId);
  return context.json({
    apps: await listApps(user.workspaceId, context.req.param("sourceId")),
  });
});

sourceRoutes.get("/:sourceId/resources", async (context) => {
  const user = context.get("user");
  await getSource(context.req.param("sourceId"), user.workspaceId);
  return context.json({
    resources: await listResources(
      user.workspaceId,
      context.req.param("sourceId"),
    ),
  });
});

sourceRoutes.get("/:sourceId/servers", async (context) => {
  const user = context.get("user");
  await getSource(context.req.param("sourceId"), user.workspaceId);
  return context.json({
    servers: await listSourceServers(
      context.req.param("sourceId"),
      user.workspaceId,
    ),
  });
});

sourceRoutes.get("/:sourceId/deployments", async (context) => {
  const user = context.get("user");
  await getSource(context.req.param("sourceId"), user.workspaceId);
  return context.json({
    deployments: await listDeployments(
      user.workspaceId,
      context.req.param("sourceId"),
    ),
  });
});

sourceRoutes.get("/:sourceId/backups", async (context) => {
  const user = context.get("user");
  await getSource(context.req.param("sourceId"), user.workspaceId);
  return context.json({
    backups: await listSourceBackups(
      context.req.param("sourceId"),
      user.workspaceId,
    ),
  });
});

sourceRoutes.get("/:sourceId/manifest", async (context) =>
  context.json({
    manifest: await getSourceManifest(
      context.req.param("sourceId"),
      context.get("user").workspaceId,
    ),
  }),
);

sourceRoutes.post("/:sourceId/actions/preview-sync", async (context) =>
  context.json(
    await previewSourceSync(
      context.req.param("sourceId"),
      context.get("user").workspaceId,
    ),
  ),
);

sourceRoutes.post("/:sourceId/actions/sync", async (context) => {
  const user = context.get("user");
  const sync = await requestSourceSync({
    requestedBy: user.id,
    sourceId: context.req.param("sourceId"),
    workspaceId: user.workspaceId,
  });
  return context.json({ sync }, 202);
});

sourceRoutes.delete("/:sourceId", async (context) => {
  const user = context.get("user");
  if (user.workspaceRole !== "owner") {
    throw forbidden("Only administrators can delete Sources");
  }
  await deleteSource(context.req.param("sourceId"), user.workspaceId);
  return context.body(null, 204);
});

sourceRoutes.get("/:sourceId/syncs", async (context) =>
  context.json({
    syncs: await listSourceSyncs(
      context.req.param("sourceId"),
      context.get("user").workspaceId,
    ),
  }),
);

sourceRoutes.get("/:sourceId/syncs/:syncId", async (context) =>
  context.json({
    sync: await getSourceSync(
      context.req.param("sourceId"),
      context.req.param("syncId"),
      context.get("user").workspaceId,
    ),
  }),
);
