import { Hono } from "hono";
import { deleteCookie, getCookie } from "hono/cookie";

import { revokeSessionByToken } from "../../../areas/auth/service.js";
import { sessionCookieName } from "../../../http/authentication.js";

import type { TowbarHonoEnvironment } from "../../../http/types.js";

export const sessionRoutes = new Hono<TowbarHonoEnvironment>();

sessionRoutes.get("/", (context) =>
  context.json({ user: context.get("user") }),
);

sessionRoutes.delete("/", async (context) => {
  const token = getCookie(context, sessionCookieName);
  if (token) {
    await revokeSessionByToken(context.get("user").id, token);
  }
  deleteCookie(context, sessionCookieName, { path: "/" });
  return context.body(null, 204);
});
