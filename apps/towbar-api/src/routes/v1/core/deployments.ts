import { operation } from "../../../http/operation.js";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";

import { listDeploymentHistory } from "../../../areas/deployments/history.js";
import { requestDeploymentRetry } from "../../../areas/apps/service.js";
import {
  cancelDeployment,
  getDeployment,
  listDeploymentLogs,
  listDeploymentSteps,
  listDeployments,
} from "../../../areas/deployments/service.js";
import {
  listDeploymentVulnerabilityFindings,
  requestDeploymentVulnerabilityScan,
} from "../../../areas/vulnerability-scans/service.js";
import { badRequest, forbidden } from "../../../http/errors.js";

import type { TowbarHonoEnvironment } from "../../../http/types.js";

const historyQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(1_000_000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(10),
  })
  .strict();

const afterSchema = z.coerce.number().int().min(-1).optional();

export const deploymentRoutes = new Hono<TowbarHonoEnvironment>();

deploymentRoutes.get(
  "/",
  operation({
    responseSchema: 'deployments.ts:get:"/"',
    summary: "List deployments",
    response: "JSON object containing deployments.",
    status: 200,
  }),
  async (context) =>
    context.json({
      deployments: await listDeployments(context.get("user").workspaceId),
    }),
);
deploymentRoutes.get(
  "/history",
  operation({
    responseSchema: 'deployments.ts:get:"/history"',
    summary: "List deployment history",
    query: historyQuerySchema,
    response: "Deployment history and pagination metadata.",
    status: 200,
  }),
  async (context) => {
    const pagination = historyQuerySchema.parse(context.req.query());
    return context.json(
      await listDeploymentHistory({
        ...pagination,
        workspaceId: context.get("user").workspaceId,
      }),
    );
  },
);
deploymentRoutes.get(
  "/:deploymentId",
  operation({
    responseSchema: 'deployments.ts:get:"/:deploymentId"',
    summary: "Get deployment",
    response: "JSON object containing deployment.",
    status: 200,
  }),
  async (context) =>
    context.json({
      deployment: await getDeployment(
        context.req.param("deploymentId"),
        context.get("user").workspaceId,
      ),
    }),
);
deploymentRoutes.get(
  "/:deploymentId/steps",
  operation({
    responseSchema: 'deployments.ts:get:"/:deploymentId/steps"',
    summary: "List deployment steps",
    response: "JSON object containing steps.",
    status: 200,
  }),
  async (context) =>
    context.json({
      steps: await listDeploymentSteps(
        context.req.param("deploymentId"),
        context.get("user").workspaceId,
      ),
    }),
);
deploymentRoutes.get(
  "/:deploymentId/logs",
  operation({
    responseSchema: 'deployments.ts:get:"/:deploymentId/logs"',
    summary: "List deployment logs",
    query: z.object({ after: afterSchema }).strict(),
    response: "JSON object containing logs.",
    status: 200,
  }),
  async (context) =>
    context.json({
      logs: await listDeploymentLogs({
        afterSequence: afterSchema.parse(context.req.query("after")),
        deploymentId: context.req.param("deploymentId"),
        workspaceId: context.get("user").workspaceId,
      }),
    }),
);
deploymentRoutes.get(
  "/:deploymentId/vulnerability-scan/findings",
  operation({
    responseSchema:
      'deployments.ts:get:"/:deploymentId/vulnerability-scan/findings"',
    summary: "List deployment vulnerability findings",
    response: "JSON object containing findings.",
    status: 200,
  }),
  async (context) =>
    context.json({
      findings: await listDeploymentVulnerabilityFindings({
        deploymentId: context.req.param("deploymentId"),
        workspaceId: context.get("user").workspaceId,
      }),
    }),
);
deploymentRoutes.get(
  "/:deploymentId/events",
  operation({
    responseSchema: 'deployments.ts:get:"/:deploymentId/events"',
    summary: "Watch deployment events",
    query: z
      .object({
        after: afterSchema,
        snapshot: z.enum(["true", "false"]).optional(),
      })
      .strict(),
    response: "JSON object containing deployment, logs, steps.",
    status: 200,
    stream: true,
  }),
  async (context) => {
    const deploymentId = context.req.param("deploymentId");
    const workspaceId = context.get("user").workspaceId;
    await getDeployment(deploymentId, workspaceId);
    if (context.req.query("snapshot") === "true") {
      return context.json({
        deployment: await getDeployment(deploymentId, workspaceId),
        logs: await listDeploymentLogs({
          deploymentId,
          workspaceId,
          afterSequence: afterSchema.parse(context.req.query("after")),
        }),
        steps: await listDeploymentSteps(deploymentId, workspaceId),
      });
    }
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
  },
);
deploymentRoutes.post(
  "/:deploymentId/actions/cancel",
  operation({
    responseSchema: 'deployments.ts:post:"/:deploymentId/actions/cancel"',
    summary: "Cancel deployment",
    response: "JSON object containing deployment.",
    status: 202,
  }),
  async (context) =>
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

deploymentRoutes.post(
  "/:deploymentId/actions/retry",
  operation({
    responseSchema: 'deployments.ts:post:"/:deploymentId/actions/retry"',
    summary: "Request deployment retry",
    idempotencyKey: true,
    response: "The retry deployment and whether the request was replayed.",
    status: 202,
  }),
  async (context) => {
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
  },
);

deploymentRoutes.post(
  "/:deploymentId/vulnerability-scan/actions/rescan",
  operation({
    responseSchema:
      'deployments.ts:post:"/:deploymentId/vulnerability-scan/actions/rescan"',
    summary: "Request deployment vulnerability scan",
    ownerOnly: true,
    response: "The scan request and its operation status.",
    status: 202,
  }),
  async (context) => {
    const user = context.get("user");
    if (user.workspaceRole !== "owner") {
      throw forbidden("Only workspace owners can request an image rescan");
    }
    const result = await requestDeploymentVulnerabilityScan({
      deploymentId: context.req.param("deploymentId"),
      force: true,
      workspaceId: user.workspaceId,
    });
    return context.json(result, result?.replayed ? 200 : 202);
  },
);

function parseLastEventSequence(value: string | undefined) {
  if (!value) return -1;
  const candidate = Number(value.slice(value.lastIndexOf(":") + 1));
  return Number.isInteger(candidate) && candidate >= -1 ? candidate : -1;
}
