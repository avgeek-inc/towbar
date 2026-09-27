import { Hono } from "hono";

import { getTowbarUpdateInfo } from "../../../areas/system-health/updates.js";
import { operation } from "../../../http/operation.js";

import type { TowbarHonoEnvironment } from "../../../http/types.js";

export const versionRoutes = new Hono<TowbarHonoEnvironment>();

versionRoutes.get(
  "/",
  operation({
    permissions: ["identity.read"],
    responseSchema: 'version.ts:get:"/"',
    summary: "Get Towbar version and latest release",
    response: "Installed version and latest published stable release.",
    status: 200,
  }),
  async (context) => context.json(await getTowbarUpdateInfo()),
);
