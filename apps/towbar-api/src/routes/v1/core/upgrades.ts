import { Hono } from "hono";
import { z } from "zod";
import {
  getUpgradeStatus,
  prepareUpgrade,
  startUpgrade,
} from "../../../areas/upgrades/runner.js";
import { forbidden } from "../../../http/errors.js";
import { operation } from "../../../http/operation.js";
import { readJson } from "../../../http/requests.js";
import type { TowbarHonoEnvironment } from "../../../http/types.js";

const planBody = z
  .object({
    targetVersion: z
      .string()
      .regex(/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u)
      .max(40),
  })
  .strict();
const jobBody = z.object({ planId: z.uuid(), requestId: z.uuid() }).strict();

export const upgradeRoutes = new Hono<TowbarHonoEnvironment>();
upgradeRoutes.get(
  "/",
  operation({
    permissions: ["system.manage"],
    browserOnly: true,
    responseSchema: 'upgrades.ts:get:"/"',
    summary: "Get host upgrade status",
    response: "Host support and the latest persisted upgrade attempt.",
    status: 200,
  }),
  async (context) => context.json(await getUpgradeStatus()),
);
upgradeRoutes.post(
  "/plan",
  operation({
    permissions: ["system.manage"],
    browserOnly: true,
    freshSession: true,
    responseSchema: 'upgrades.ts:post:"/plan"',
    body: planBody,
    summary: "Prepare a host upgrade",
    response: "Pinned release and readiness blockers.",
    status: 200,
  }),
  async (context) => {
    const body = await readJson(context, planBody);
    return context.json(await prepareUpgrade(body.targetVersion));
  },
);
upgradeRoutes.post(
  "/jobs",
  operation({
    permissions: ["system.manage"],
    browserOnly: true,
    freshSession: true,
    responseSchema: 'upgrades.ts:post:"/jobs"',
    body: jobBody,
    summary: "Start a confirmed host upgrade",
    response: "Persisted version-locked upgrade attempt.",
    status: 200,
  }),
  async (context) => {
    const body = await readJson(context, jobBody);
    const actor = context.get("actor");
    if (actor.kind !== "session")
      throw forbidden("Sign in as an Admin to upgrade Towbar.");
    return context.json(await startUpgrade({ ...body, actorId: actor.userId }));
  },
);
