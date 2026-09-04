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
  cancelResourceRestore,
  getResourceBackupAssurance,
  listDeployableOperations,
  listOperationEvents,
  listResourceBackupAssurances,
  requestDeployableOperation,
  requestResourceRestore,
  requestRestoreCleanup,
} from "../../../areas/resource-operations/service.js";
import { hasAwsCredentials } from "../../../areas/aws/service.js";
import { badRequest, forbidden } from "../../../http/errors.js";
import { readJson } from "../../../http/requests.js";
import { autoDeployControlPatchSchema } from "./auto-deploy-control-requests.js";
import {
  getDeployableAutoDeployControl,
  updateDeployableAutoDeployControl,
} from "../../../areas/auto-deploy-controls/service.js";
import { wakeMaintenanceWorkflow } from "../../../infrastructure/temporal.js";

import type { TowbarHonoEnvironment } from "../../../http/types.js";

const rollbackSchema = z
  .object({ releaseId: z.string().uuid().optional() })
  .strict();
const logsSchema = z
  .object({ tail: z.number().int().min(1).max(5_000) })
  .strict();
const restoreSchema = z
  .object({
    backupId: z.string().uuid(),
    confirmation: z.string().trim().min(1).max(255),
    reason: z.string().trim().min(10).max(1_000),
  })
  .strict();
const restoreCleanupSchema = z
  .object({ restoreId: z.string().uuid() })
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

resourceRoutes.get("/:resourceId/auto-deploy-control", async (context) => {
  const user = context.get("user");
  return context.json({
    autoDeploy: await getDeployableAutoDeployControl({
      deployableId: context.req.param("resourceId"),
      expectedType: "resource",
      workspaceId: user.workspaceId,
    }),
    canManageAutoDeploy: user.workspaceRole === "owner",
  });
});

resourceRoutes.patch("/:resourceId/auto-deploy-control", async (context) => {
  const user = context.get("user");
  if (user.workspaceRole !== "owner") {
    throw forbidden("Only the owner can manage automatic deployment controls");
  }
  const result = await updateDeployableAutoDeployControl({
    deployableId: context.req.param("resourceId"),
    expectedType: "resource",
    ...(await readJson(context, autoDeployControlPatchSchema)),
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

resourceRoutes.get("/:resourceId/backup-assurance", async (context) => {
  const user = context.get("user");
  return context.json({
    assurance: await getResourceBackupAssurance(
      context.req.param("resourceId"),
      user.workspaceId,
    ),
    assurances: await listResourceBackupAssurances(
      context.req.param("resourceId"),
      user.workspaceId,
    ),
    awsConfigured: await hasAwsCredentials(user.workspaceId),
    canRestore: user.workspaceRole === "owner",
  });
});

resourceRoutes.get(
  "/:resourceId/operations/:operationId/events",
  async (context) =>
    context.json({
      events: await listOperationEvents(
        context.req.param("operationId"),
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

resourceRoutes.post("/:resourceId/actions/restore", async (context) => {
  const user = context.get("user");
  if (user.workspaceRole !== "owner") {
    throw forbidden("Only the owner can restore database Resources");
  }
  const input = await readJson(context, restoreSchema);
  const result = await requestResourceRestore({
    ...input,
    idempotencyKey: requireIdempotencyKey(
      context.req.header("idempotency-key"),
    ),
    requestedBy: user.id,
    resourceId: context.req.param("resourceId"),
    workspaceId: user.workspaceId,
  });
  return context.json(result, result.replayed ? 200 : 202);
});

resourceRoutes.post("/:resourceId/actions/restore-cleanup", async (context) => {
  const user = context.get("user");
  if (user.workspaceRole !== "owner") {
    throw forbidden("Only the owner can clean up rollback volumes");
  }
  const input = await readJson(context, restoreCleanupSchema);
  const result = await requestRestoreCleanup({
    ...input,
    idempotencyKey: requireIdempotencyKey(
      context.req.header("idempotency-key"),
    ),
    requestedBy: user.id,
    resourceId: context.req.param("resourceId"),
    workspaceId: user.workspaceId,
  });
  return context.json(result, result.replayed ? 200 : 202);
});

resourceRoutes.post(
  "/:resourceId/operations/:operationId/actions/cancel",
  async (context) => {
    const user = context.get("user");
    if (user.workspaceRole !== "owner") {
      throw forbidden("Only the owner can cancel database restores");
    }
    return context.json({
      operation: await cancelResourceRestore({
        operationId: context.req.param("operationId"),
        requestedBy: user.id,
        resourceId: context.req.param("resourceId"),
        workspaceId: user.workspaceId,
      }),
    });
  },
);

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
