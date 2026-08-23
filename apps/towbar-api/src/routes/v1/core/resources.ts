import { Hono } from "hono";
import { z } from "zod";

import {
  getResource,
  listResourceDeployments,
  listResourceReleases,
  listResources,
  requestAppDeployment,
  requestAppRollback,
} from "../../../areas/apps/service.js";
import {
  listDeployableOperations,
  requestDeployableOperation,
} from "../../../areas/resource-operations/service.js";
import { badRequest } from "../../../http/errors.js";
import { readJson } from "../../../http/requests.js";

import type { TowbarHonoEnvironment } from "../../../http/types.js";

const rollbackSchema = z
  .object({ releaseId: z.string().uuid().optional() })
  .strict();
const logsSchema = z
  .object({ tail: z.number().int().min(1).max(5_000) })
  .strict();

export const resourceRoutes = new Hono<TowbarHonoEnvironment>();

resourceRoutes.get("/", async (context) =>
  context.json({
    resources: await listResources(context.get("user").workspaceId),
  }),
);

resourceRoutes.get("/:resourceId", async (context) => {
  const user = context.get("user");
  return context.json({
    resource: await getResource(
      context.req.param("resourceId"),
      user.workspaceId,
    ),
  });
});

resourceRoutes.get("/:resourceId/deployments", async (context) =>
  context.json({
    deployments: await listResourceDeployments(
      context.req.param("resourceId"),
      context.get("user").workspaceId,
    ),
  }),
);

resourceRoutes.get("/:resourceId/releases", async (context) =>
  context.json({
    releases: await listResourceReleases(
      context.req.param("resourceId"),
      context.get("user").workspaceId,
    ),
  }),
);

resourceRoutes.get("/:resourceId/operations", async (context) =>
  context.json({
    operations: await listDeployableOperations(
      context.req.param("resourceId"),
      context.get("user").workspaceId,
    ),
  }),
);

resourceRoutes.post("/:resourceId/actions/deploy", async (context) => {
  const idempotencyKey = requireIdempotencyKey(
    context.req.header("idempotency-key"),
  );
  const user = context.get("user");
  const result = await requestAppDeployment({
    appId: context.req.param("resourceId"),
    expectedType: "resource",
    idempotencyKey,
    requestedBy: user.id,
    workspaceId: user.workspaceId,
  });
  return context.json(result, result.replayed ? 200 : 202);
});

resourceRoutes.post("/:resourceId/actions/rollback", async (context) => {
  const idempotencyKey = requireIdempotencyKey(
    context.req.header("idempotency-key"),
  );
  const input = await readJson(context, rollbackSchema);
  const user = context.get("user");
  const result = await requestAppRollback({
    appId: context.req.param("resourceId"),
    expectedType: "resource",
    idempotencyKey,
    releaseId: input.releaseId,
    requestedBy: user.id,
    workspaceId: user.workspaceId,
  });
  return context.json(result, result.replayed ? 200 : 202);
});

for (const action of ["backup", "restart", "start", "stop"] as const) {
  resourceRoutes.post(`/:resourceId/actions/${action}`, async (context) => {
    const user = context.get("user");
    const result = await requestDeployableOperation({
      deployableId: context.req.param("resourceId"),
      idempotencyKey: requireIdempotencyKey(
        context.req.header("idempotency-key"),
      ),
      requestedBy: user.id,
      request: { type: action },
      workspaceId: user.workspaceId,
    });
    return context.json(result, result.replayed ? 200 : 202);
  });
}

resourceRoutes.post("/:resourceId/actions/logs", async (context) => {
  const user = context.get("user");
  const input = await readJson(context, logsSchema);
  const result = await requestDeployableOperation({
    deployableId: context.req.param("resourceId"),
    idempotencyKey: requireIdempotencyKey(
      context.req.header("idempotency-key"),
    ),
    requestedBy: user.id,
    request: { tail: input.tail, type: "capture_logs" },
    workspaceId: user.workspaceId,
  });
  return context.json(result, result.replayed ? 200 : 202);
});

function requireIdempotencyKey(value: string | undefined) {
  const key = value?.trim();
  if (!key || key.length > 255) {
    throw badRequest(
      "A valid Idempotency-Key header is required",
      "IDEMPOTENCY_KEY_REQUIRED",
    );
  }
  return key;
}
