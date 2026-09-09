import { z } from "zod";
import { operation } from "../../../http/operation.js";
import { type Context, Hono } from "hono";
import {
  secretEnvironmentSchema,
  secretKeySchema,
  secretMutationSchema,
  secretStageSchema,
} from "@workspace/towbar-core";
import {
  getEnvironmentSecretOwner,
  listEnvironmentSecrets,
  updateEnvironmentSecrets,
} from "../../../areas/apps/secrets.js";
import { getApp, getResource } from "../../../areas/apps/queries.js";
import {
  revealSecretValue,
  revealSecretValues,
} from "../../../areas/secrets/store.js";
import { forbidden, unprocessable } from "../../../http/errors.js";
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
  routes.post(
    "/:environment/:stage/reveal",
    operation({
      responseSchema:
        'environment-secrets.ts:post:"/:environment/:stage/reveal"',
      summary: "Reveal an environment secret",
      body: z.object({ key: secretKeySchema }).strict(),
      ownerOnly: true,
      response: "JSON object containing the stored value and revision.",
      status: 200,
    }),
    async (context) => {
      const { slot, actorUserId } = await revealSlot(context);
      const { key } = await readJson(
        context,
        z.object({ key: secretKeySchema }).strict(),
        2048,
      );
      return context.json(await revealSecretValue(slot, key, actorUserId));
    },
  );
  routes.post(
    "/:environment/:stage/reveal-all",
    operation({
      responseSchema:
        'environment-secrets.ts:post:"/:environment/:stage/reveal-all"',
      summary: "Reveal all environment secrets in a stage",
      body: z.object({}).strict(),
      ownerOnly: true,
      response: "JSON object containing stored values and their revision.",
      status: 200,
    }),
    async (context) => {
      const { slot, actorUserId } = await revealSlot(context);
      await readJson(context, z.object({}).strict(), 2048);
      return context.json(await revealSecretValues(slot, actorUserId));
    },
  );
  async function revealSlot(context: Context<TowbarHonoEnvironment>) {
    const user = context.get("user");
    if (user.workspaceRole !== "owner")
      throw forbidden("Only the owner can reveal secrets");
    const owner =
      kind === "workspace"
        ? { type: "workspace" as const, workspaceId: user.workspaceId }
        : {
            type: kind === "source" ? ("source" as const) : ("app" as const),
            id: readUuidPathParameter(context.req.param("ownerId")!, "ownerId"),
            workspaceId: user.workspaceId,
          };
    const ownership = await getEnvironmentSecretOwner(owner);
    const environment = secretEnvironmentSchema.parse(
      context.req.param("environment"),
    );
    const stage = secretStageSchema.parse(context.req.param("stage"));
    if (
      ownership.resource &&
      (environment !== "production" || stage !== "deployment")
    )
      throw unprocessable("Resources only support production runtime secrets");

    return { slot: { ...owner, environment, stage }, actorUserId: user.id };
  }
  return routes;
}
