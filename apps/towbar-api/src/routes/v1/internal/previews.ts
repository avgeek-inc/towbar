import { Hono } from "hono";

import { previewBranchEventSchema } from "@workspace/towbar-core/temporal";
import { z } from "zod";

import {
  getPreviewCleanupContext,
  recordPreviewCleanupResult,
  resolvePreviewCleanupSecrets,
} from "../../../areas/previews/cleanup.js";
import { processPreviewBranchEvent } from "../../../areas/previews/service.js";
import { readJson, readUuidPathParameter } from "../../../http/requests.js";

export const internalPreviewRoutes = new Hono();

internalPreviewRoutes.post("/events", async (context) =>
  context.json(
    await processPreviewBranchEvent(
      await readJson(context, previewBranchEventSchema),
    ),
  ),
);

const cleanupResultSchema = z
  .object({
    errorMessage: z.string().max(1_000).optional(),
    succeeded: z.boolean(),
  })
  .strict();
const environmentId = (value: string) =>
  readUuidPathParameter(value, "previewEnvironmentId");

internalPreviewRoutes.get(
  "/:previewEnvironmentId/cleanup/context",
  async (context) =>
    context.json(
      await getPreviewCleanupContext(
        environmentId(context.req.param("previewEnvironmentId")),
      ),
    ),
);
internalPreviewRoutes.post(
  "/:previewEnvironmentId/cleanup/secrets/resolve",
  async (context) =>
    context.json(
      await resolvePreviewCleanupSecrets(
        environmentId(context.req.param("previewEnvironmentId")),
      ),
    ),
);
internalPreviewRoutes.post(
  "/:previewEnvironmentId/cleanup/result",
  async (context) =>
    context.json(
      await recordPreviewCleanupResult(
        environmentId(context.req.param("previewEnvironmentId")),
        await readJson(context, cleanupResultSchema),
      ),
    ),
);
