import { Hono } from "hono";
import { z } from "zod";

import { deploymentLogChunkCharacterLimit } from "@workspace/towbar-core/temporal";

import {
  commitDeploymentRelease,
  deploymentStateSchema,
  getDeploymentExecutionContext,
  getDeploymentRecoveryStatus,
  recordDeploymentEvent,
  resolveDeploymentLogin,
  resolveDeploymentSecrets,
} from "../../../areas/deployments/service.js";
import { continueAutomaticDeployments } from "../../../areas/apps/automatic-deployments.js";
import { readJson, readUuidPathParameter } from "../../../http/requests.js";

const deploymentId = (value: string) =>
  readUuidPathParameter(value, "deploymentId");

const eventSchema = z
  .object({
    errorCode: z.string().trim().min(1).max(100).optional(),
    log: z
      .object({
        content: z.string().max(deploymentLogChunkCharacterLimit),
        stream: z.enum(["stderr", "stdout"]),
      })
      .strict()
      .optional(),
    message: z.string().max(1_000).optional(),
    state: deploymentStateSchema.optional(),
  })
  .strict();
const releaseSchema = z
  .object({
    containerName: z.string().trim().min(1).max(255),
    imageTag: z.string().trim().min(1).max(255),
  })
  .strict();

export const internalDeploymentRoutes = new Hono();

internalDeploymentRoutes.get("/:deploymentId/context", async (context) =>
  context.json({
    context: await getDeploymentExecutionContext(
      deploymentId(context.req.param("deploymentId")),
    ),
  }),
);
internalDeploymentRoutes.get("/:deploymentId/recovery", async (context) =>
  context.json(
    await getDeploymentRecoveryStatus(
      deploymentId(context.req.param("deploymentId")),
    ),
  ),
);
internalDeploymentRoutes.post(
  "/:deploymentId/secrets/resolve",
  async (context) =>
    context.json({
      secrets: await resolveDeploymentSecrets(
        deploymentId(context.req.param("deploymentId")),
      ),
    }),
);
internalDeploymentRoutes.post(
  "/:deploymentId/auto-deploy/continue",
  (context) =>
    context.json(
      continueAutomaticDeployments(
        deploymentId(context.req.param("deploymentId")),
      ),
    ),
);

internalDeploymentRoutes.post(
  "/:deploymentId/secrets/login/resolve",
  async (context) => {
    return context.json({
      login: await resolveDeploymentLogin(
        deploymentId(context.req.param("deploymentId")),
      ),
    });
  },
);
internalDeploymentRoutes.post("/:deploymentId/events", async (context) => {
  const body = await readJson(context, eventSchema);
  return context.json(
    await recordDeploymentEvent(
      deploymentId(context.req.param("deploymentId")),
      body,
    ),
  );
});
internalDeploymentRoutes.post(
  "/:deploymentId/releases/commit",
  async (context) => {
    const body = await readJson(context, releaseSchema);
    return context.json(
      await commitDeploymentRelease(
        deploymentId(context.req.param("deploymentId")),
        body,
      ),
    );
  },
);
