import { Hono } from "hono";
import { z } from "zod";

import {
  getApp,
  listAppDeployments,
  listAppReleases,
  listApps,
  requestAppDeployment,
  requestAppRollback,
} from "../../../areas/apps/service.js";
import {
  listAppSecretBindings,
  revealAppSecretBinding,
  updateAppSecretBinding,
} from "../../../areas/apps/secrets.js";
import {
  listDeployableOperations,
  requestDeployableOperation,
} from "../../../areas/resource-operations/service.js";
import { listPreviewEnvironments } from "../../../areas/previews/service.js";
import { badRequest, forbidden } from "../../../http/errors.js";
import { readJson } from "../../../http/requests.js";
import { autoDeployControlPatchSchema } from "./auto-deploy-control-requests.js";
import {
  getDeployableAutoDeployControl,
  updateDeployableAutoDeployControl,
} from "../../../areas/auto-deploy-controls/service.js";
import { wakeMaintenanceWorkflow } from "../../../infrastructure/temporal.js";
import {
  secretMutationSchema,
  secretReferenceSchema,
} from "./secret-requests.js";

import type { TowbarHonoEnvironment } from "../../../http/types.js";

const rollbackSchema = z
  .object({ releaseId: z.string().uuid().optional() })
  .strict();
const logsSchema = z
  .object({ tail: z.number().int().min(1).max(5_000) })
  .strict();
export const appRoutes = new Hono<TowbarHonoEnvironment>();

appRoutes.get("/", async (context) =>
  context.json({ apps: await listApps(context.get("user").workspaceId) }),
);

appRoutes.get("/:appId", async (context) => {
  const user = context.get("user");
  return context.json({
    app: await getApp(context.req.param("appId"), user.workspaceId),
  });
});

appRoutes.get("/:appId/auto-deploy-control", async (context) => {
  const user = context.get("user");
  return context.json({
    autoDeploy: await getDeployableAutoDeployControl({
      deployableId: context.req.param("appId"),
      expectedType: "app",
      workspaceId: user.workspaceId,
    }),
    canManageAutoDeploy: user.workspaceRole === "owner",
  });
});

appRoutes.patch("/:appId/auto-deploy-control", async (context) => {
  const user = context.get("user");
  if (user.workspaceRole !== "owner") {
    throw forbidden("Only the owner can manage automatic deployment controls");
  }
  const result = await updateDeployableAutoDeployControl({
    deployableId: context.req.param("appId"),
    expectedType: "app",
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

appRoutes.get("/:appId/secrets", async (context) => {
  const user = context.get("user");
  return context.json({
    bindings: await listAppSecretBindings({
      appId: context.req.param("appId"),
      workspaceId: user.workspaceId,
    }),
    canManageSecrets: user.workspaceRole === "owner",
  });
});

appRoutes.post("/:appId/secrets/reveal", async (context) => {
  const user = context.get("user");
  if (user.workspaceRole !== "owner") {
    throw forbidden("Only the owner can reveal App secrets");
  }
  const input = await readJson(context, secretReferenceSchema, 4 * 1_024);
  const secret = await revealAppSecretBinding({
    appId: context.req.param("appId"),
    reference: input.reference,
    workspaceId: user.workspaceId,
  });
  context.header("Cache-Control", "no-store, max-age=0");
  context.header("Pragma", "no-cache");
  return context.json({ secret });
});

appRoutes.patch("/:appId/secrets", async (context) => {
  const user = context.get("user");
  if (user.workspaceRole !== "owner") {
    throw forbidden("Only the owner can manage App secrets");
  }
  const input = await readJson(context, secretMutationSchema, 256 * 1_024);
  const secret = await updateAppSecretBinding({
    appId: context.req.param("appId"),
    mutation: {
      delete: input.delete,
      expectedVersionId: input.expectedVersionId,
      set: input.set,
    },
    reference: input.reference,
    workspaceId: user.workspaceId,
  });
  return context.json({ secret });
});

appRoutes.get("/:appId/deployments", async (context) =>
  context.json({
    deployments: await listAppDeployments(
      context.req.param("appId"),
      context.get("user").workspaceId,
    ),
  }),
);

appRoutes.get("/:appId/releases", async (context) =>
  context.json({
    releases: await listAppReleases(
      context.req.param("appId"),
      context.get("user").workspaceId,
    ),
  }),
);

appRoutes.get("/:appId/previews", async (context) =>
  context.json({
    previews: await listPreviewEnvironments({
      appId: context.req.param("appId"),
      workspaceId: context.get("user").workspaceId,
    }),
  }),
);

appRoutes.get("/:appId/operations", async (context) =>
  context.json({
    operations: await listDeployableOperations(
      context.req.param("appId"),
      context.get("user").workspaceId,
    ),
  }),
);

appRoutes.post("/:appId/actions/deploy", async (context) => {
  const idempotencyKey = requireIdempotencyKey(
    context.req.header("idempotency-key"),
  );
  const user = context.get("user");
  const result = await requestAppDeployment({
    appId: context.req.param("appId"),
    idempotencyKey,
    requestedBy: user.id,
    workspaceId: user.workspaceId,
  });
  return context.json(result, result.replayed ? 200 : 202);
});

appRoutes.post("/:appId/actions/rollback", async (context) => {
  const idempotencyKey = requireIdempotencyKey(
    context.req.header("idempotency-key"),
  );
  const input = await readJson(context, rollbackSchema);
  const user = context.get("user");
  const result = await requestAppRollback({
    appId: context.req.param("appId"),
    idempotencyKey,
    releaseId: input.releaseId,
    requestedBy: user.id,
    workspaceId: user.workspaceId,
  });
  return context.json(result, result.replayed ? 200 : 202);
});

for (const action of ["restart", "start", "stop"] as const) {
  appRoutes.post(`/:appId/actions/${action}`, async (context) => {
    const user = context.get("user");
    const result = await requestDeployableOperation({
      deployableId: context.req.param("appId"),
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

appRoutes.post("/:appId/actions/logs", async (context) => {
  const user = context.get("user");
  const input = await readJson(context, logsSchema);
  const result = await requestDeployableOperation({
    deployableId: context.req.param("appId"),
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
