import { Hono } from "hono";
import { z } from "zod";
import { sourceEnvironmentMappingSchema } from "@workspace/towbar-core";
import {
  connectSourceEnvironment,
  disconnectSourceEnvironment,
  listSourceEnvironments,
  requestEnvironmentSync,
  updateEnvironmentBranch,
} from "../../../areas/sources/environments.js";
import { forbidden } from "../../../http/errors.js";
import { operation } from "../../../http/operation.js";
import { readJson, readUuidPathParameter } from "../../../http/requests.js";
import type { TowbarHonoEnvironment } from "../../../http/types.js";

const revisionSchema = z
  .object({ expectedRevision: z.string().uuid() })
  .strict();
const branchSchema = revisionSchema.extend({
  branch: sourceEnvironmentMappingSchema.shape.branch,
});
export const sourceEnvironmentRoutes = new Hono<TowbarHonoEnvironment>();
sourceEnvironmentRoutes.use("*", async (context, next) => {
  if (
    context.req.method !== "GET" &&
    context.get("user").workspaceRole !== "owner"
  ) {
    throw forbidden("Only the owner can manage environments");
  }
  await next();
});

sourceEnvironmentRoutes.get(
  "/",
  operation({
    responseSchema: 'source-environments.ts:get:"/"',
    summary: "List source environments",
    response: "Connected source environments and branch mappings.",
    status: 200,
  }),
  async (context) =>
    context.json({
      environments: await listSourceEnvironments(
        readUuidPathParameter(context.req.param("sourceId")!, "sourceId"),
        context.get("user").workspaceId,
      ),
    }),
);

sourceEnvironmentRoutes.post(
  "/",
  operation({
    responseSchema: 'source-environments.ts:post:"/"',
    summary: "Connect source environment",
    body: sourceEnvironmentMappingSchema,
    ownerOnly: true,
    response: "Connected environment and initial sync.",
    status: 201,
  }),
  async (context) => {
    const user = context.get("user");
    const sourceId = readUuidPathParameter(
      context.req.param("sourceId")!,
      "sourceId",
    );
    const mapping = await readJson(context, sourceEnvironmentMappingSchema);
    const environment = await connectSourceEnvironment({
      ...mapping,
      sourceId,
      workspaceId: user.workspaceId,
      actorUserId: user.id,
    });
    const sync = await requestEnvironmentSync({
      sourceId,
      environmentId: environment.id,
      workspaceId: user.workspaceId,
      requestedBy: user.id,
      deployAfterSync: false,
    });
    return context.json({ environment, sync }, 201);
  },
);

sourceEnvironmentRoutes.patch(
  "/:environmentId",
  operation({
    responseSchema: 'source-environments.ts:patch:"/:environmentId"',
    summary: "Change environment branch",
    body: branchSchema,
    ownerOnly: true,
    response: "Updated mapping and queued sync.",
    status: 200,
  }),
  async (context) => {
    const user = context.get("user");
    const sourceId = readUuidPathParameter(
      context.req.param("sourceId")!,
      "sourceId",
    );
    const environmentId = readUuidPathParameter(
      context.req.param("environmentId"),
      "environmentId",
    );
    const input = await readJson(context, branchSchema);
    const environment = await updateEnvironmentBranch({
      ...input,
      sourceId,
      environmentId,
      workspaceId: user.workspaceId,
      actorUserId: user.id,
    });
    const sync = await requestEnvironmentSync({
      sourceId,
      environmentId,
      workspaceId: user.workspaceId,
      requestedBy: user.id,
      deployAfterSync: true,
    });
    return context.json({ environment, sync });
  },
);

sourceEnvironmentRoutes.post(
  "/:environmentId/syncs",
  operation({
    responseSchema: 'source-environments.ts:post:"/:environmentId/syncs"',
    summary: "Sync environment",
    ownerOnly: true,
    response: "Queued environment sync.",
    status: 202,
  }),
  async (context) => {
    const user = context.get("user");
    const sync = await requestEnvironmentSync({
      sourceId: readUuidPathParameter(
        context.req.param("sourceId")!,
        "sourceId",
      ),
      environmentId: readUuidPathParameter(
        context.req.param("environmentId"),
        "environmentId",
      ),
      workspaceId: user.workspaceId,
      requestedBy: user.id,
      deployAfterSync: true,
    });
    return context.json({ sync }, 202);
  },
);

sourceEnvironmentRoutes.delete(
  "/:environmentId",
  operation({
    responseSchema: 'source-environments.ts:delete:"/:environmentId"',
    summary: "Disconnect environment",
    ownerOnly: true,
    body: revisionSchema,
    response: "Disconnected environment; workload data is preserved.",
    status: 200,
  }),
  async (context) => {
    const user = context.get("user");
    const input = await readJson(context, revisionSchema);
    return context.json({
      environment: await disconnectSourceEnvironment({
        ...input,
        sourceId: readUuidPathParameter(
          context.req.param("sourceId")!,
          "sourceId",
        ),
        environmentId: readUuidPathParameter(
          context.req.param("environmentId"),
          "environmentId",
        ),
        workspaceId: user.workspaceId,
        actorUserId: user.id,
      }),
    });
  },
);
