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
