import { z } from "zod";
import { operation } from "../../../http/operation.js";
import { Hono } from "hono";
import {
  secretEnvironmentSchema,
  secretMutationSchema,
  secretStageSchema,
} from "@workspace/towbar-core";
import {
  listEnvironmentSecrets,
  updateEnvironmentSecrets,
} from "../../../areas/apps/secrets.js";
import { getApp, getResource } from "../../../areas/apps/queries.js";
import { forbidden } from "../../../http/errors.js";
import { readJson, readUuidPathParameter } from "../../../http/requests.js";
import type { TowbarHonoEnvironment } from "../../../http/types.js";

export function environmentSecretRoutes(
  kind: "workspace" | "source" | "app" | "resource",
) {
  const routes = new Hono<TowbarHonoEnvironment>();
  routes.use("*", async (context, next) => {
    const id =
      kind === "workspace"
        ? null
        : readUuidPathParameter(context.req.param("ownerId")!, "ownerId");
    const workspaceId = context.get("user").workspaceId;
    if (kind === "app") await getApp(id!, workspaceId);
    if (kind === "resource") await getResource(id!, workspaceId);
    context.header("Cache-Control", "no-store");
    await next();
  });
  routes.get(
    "/",
    operation({
      responseSchema: 'environment-secrets.ts:get:"/"',
      summary: "List environment secrets",
      query: z
        .object({ environment: secretEnvironmentSchema.optional() })
        .strict(),
      response: "JSON object containing bindings, canManageSecrets.",
      status: 200,
    }),
    async (context) => {
      const user = context.get("user");
      const environment = secretEnvironmentSchema.parse(
        context.req.query("environment") ?? "production",
      );
      const owner =
        kind === "workspace"
          ? ({ type: "workspace", workspaceId: user.workspaceId } as const)
          : ({
              type: kind === "source" ? ("source" as const) : ("app" as const),
              id: readUuidPathParameter(
                context.req.param("ownerId")!,
                "ownerId",
              ),
              workspaceId: user.workspaceId,
            } as const);
      return context.json({
        bindings: await listEnvironmentSecrets(owner, environment),
        canManageSecrets: user.workspaceRole === "owner",
      });
    },
  );
  routes.patch(
    "/:environment/:stage",
    operation({
      responseSchema: 'environment-secrets.ts:patch:"/:environment/:stage"',
      summary: "Update environment secrets",
      body: secretMutationSchema,
      ownerOnly: true,
      response: "JSON object containing secret.",
      status: 200,
    }),
    async (context) => {
      const user = context.get("user");
      if (user.workspaceRole !== "owner")
        throw forbidden("Only the owner can manage secrets");
      return context.json({
        secret: await updateEnvironmentSecrets({
          owner:
            kind === "workspace"
              ? { type: "workspace", workspaceId: user.workspaceId }
              : {
                  type: kind === "source" ? "source" : "app",
                  id: readUuidPathParameter(
                    context.req.param("ownerId")!,
                    "ownerId",
                  ),
                  workspaceId: user.workspaceId,
                },
          actorUserId: user.id,
          environment: secretEnvironmentSchema.parse(
            context.req.param("environment"),
          ),
          stage: secretStageSchema.parse(context.req.param("stage")),
          mutation: await readJson(context, secretMutationSchema, 300 * 1024),
        }),
      });
    },
  );
  return routes;
}
