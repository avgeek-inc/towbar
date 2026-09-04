import { requestPreviewDeployment } from "../../../areas/previews/manual-deployment.js";
import { forbidden } from "../../../http/errors.js";
import { Hono } from "hono";

import { requestPreviewEnvironmentCleanup } from "../../../areas/previews/cleanup.js";
import { readUuidPathParameter } from "../../../http/requests.js";

import type { TowbarHonoEnvironment } from "../../../http/types.js";

export const previewRoutes = new Hono<TowbarHonoEnvironment>();

previewRoutes.post("/:previewEnvironmentId/actions/delete", async (context) => {
  const result = await requestPreviewEnvironmentCleanup({
    previewEnvironmentId: readUuidPathParameter(
      context.req.param("previewEnvironmentId"),
      "previewEnvironmentId",
    ),
    workspaceId: context.get("user").workspaceId,
  });
  return context.json(result, result.accepted ? 202 : 200);
});

previewRoutes.post("/:previewEnvironmentId/actions/deploy", async (context) => {
  const user = context.get("user");
  if (user.workspaceRole !== "owner")
    throw forbidden("Only the owner can deploy previews");
  return context.json(
    await requestPreviewDeployment({
      previewEnvironmentId: readUuidPathParameter(
        context.req.param("previewEnvironmentId"),
        "previewEnvironmentId",
      ),
      workspaceId: user.workspaceId,
      requestedBy: user.id,
    }),
    202,
  );
});
