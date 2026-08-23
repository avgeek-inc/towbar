import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";

import { requestDeploymentRetry } from "../../../areas/apps/service.js";
import {
  cancelDeployment,
  getDeployment,
  listDeploymentLogs,
  listDeploymentSteps,
  listDeployments,
} from "../../../areas/deployments/service.js";
import { badRequest } from "../../../http/errors.js";

import type { TowbarHonoEnvironment } from "../../../http/types.js";

const afterSchema = z.coerce.number().int().min(-1).optional();

export const deploymentRoutes = new Hono<TowbarHonoEnvironment>();

deploymentRoutes.get("/", async (context) =>
  context.json({
    deployments: await listDeployments(context.get("user").workspaceId),
  }),
);
deploymentRoutes.get("/:deploymentId", async (context) =>
  context.json({
    deployment: await getDeployment(
      context.req.param("deploymentId"),
      context.get("user").workspaceId,
    ),
  }),
);
deploymentRoutes.get("/:deploymentId/steps", async (context) =>
  context.json({
    steps: await listDeploymentSteps(
      context.req.param("deploymentId"),
      context.get("user").workspaceId,
    ),
  }),
);
deploymentRoutes.get("/:deploymentId/logs", async (context) =>
  context.json({
    logs: await listDeploymentLogs({
      afterSequence: afterSchema.parse(context.req.query("after")),
      deploymentId: context.req.param("deploymentId"),
      workspaceId: context.get("user").workspaceId,
    }),
  }),
);
deploymentRoutes.get("/:deploymentId/events", async (context) => {
  const deploymentId = context.req.param("deploymentId");
  const workspaceId = context.get("user").workspaceId;
  await getDeployment(deploymentId, workspaceId);
  return streamSSE(context, async (stream) => {
    let after = parseLastEventSequence(
      context.req.header("last-event-id") ?? context.req.query("after"),
    );
    for (let index = 0; index < 25; index += 1) {
      const deployment = await getDeployment(deploymentId, workspaceId);
      const logs = await listDeploymentLogs({
        afterSequence: after,
        deploymentId,
        workspaceId,
      });
      const steps = await listDeploymentSteps(deploymentId, workspaceId);
      if (logs.length > 0) after = logs.at(-1)?.sequence ?? after;
      await stream.writeSSE({
        data: JSON.stringify({ deployment, logs, steps }),
        event: "deployment",
        id: `${deployment.updatedAt.toISOString()}:${after}`,
      });
      if (
        [
          "cancelled",
          "failed",
          "succeeded",
          "succeeded_with_warnings",
          "skipped",
        ].includes(deployment.state)
      )
        return;
      await stream.sleep(1_000);
    }
  });
});
deploymentRoutes.post("/:deploymentId/actions/cancel", async (context) =>
  context.json(
    {
      deployment: await cancelDeployment(
        context.req.param("deploymentId"),
        context.get("user").workspaceId,
      ),
    },
    202,
  ),
);

deploymentRoutes.post("/:deploymentId/actions/retry", async (context) => {
  const user = context.get("user");
  const idempotencyKey = context.req.header("idempotency-key")?.trim();
  if (!idempotencyKey || idempotencyKey.length > 255) {
    throw badRequest(
      "A valid Idempotency-Key header is required",
      "IDEMPOTENCY_KEY_REQUIRED",
    );
  }
  const result = await requestDeploymentRetry({
    deploymentId: context.req.param("deploymentId"),
    idempotencyKey,
    requestedBy: user.id,
    workspaceId: user.workspaceId,
  });
  return context.json(result, result.replayed ? 200 : 202);
});

function parseLastEventSequence(value: string | undefined) {
  if (!value) return -1;
  const candidate = Number(value.slice(value.lastIndexOf(":") + 1));
  return Number.isInteger(candidate) && candidate >= -1 ? candidate : -1;
}
