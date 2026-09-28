import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import { dateTimeLocalizationSchema } from "@workspace/towbar-core/date-time";
import { localizeJsonResponse } from "../../http/localization.js";
import type { TowbarHonoEnvironment } from "../../http/types.js";

export async function verifyFilterOptionsResponse({
  appId,
  workspaceId,
}: {
  appId: string;
  workspaceId: string;
}) {
  const { analyticsRoutes } = await import("../../routes/v1/core/analytics.js");
  const router = new Hono<TowbarHonoEnvironment>();
  const userId = randomUUID();
  router.use("*", async (context, next) => {
    context.set("user", {
      id: userId,
      email: "analytics@example.test",
      name: "Analytics test",
      workspaceId,
      workspaceRole: "viewer",
    });
    context.set("actor", {
      kind: "session",
      workspaceId,
      userId,
      role: "viewer",
    });
    await next();
  });
  router.use("*", localizeJsonResponse);
  router.route("/", analyticsRoutes);
  const response = await router.request(
    `/apps/${appId}/analytics/filter-options?kind=pageview&days=1&field=referrer&search=example`,
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const body = z
    .strictObject({
      options: z.array(z.string()),
      localization: dateTimeLocalizationSchema,
    })
    .parse(await response.json());
  assert.deepEqual(body.options, ["example.com"]);
}
