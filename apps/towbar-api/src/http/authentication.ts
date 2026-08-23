import { getCookie } from "hono/cookie";

import { getEnv } from "../env.js";
import { findSession } from "../areas/auth/service.js";
import { forbidden, unauthorized } from "./errors.js";

import type { MiddlewareHandler } from "hono";
import type { TowbarHonoEnvironment } from "./types.js";

export const sessionCookieName =
  getEnv().NODE_ENV === "production"
    ? "__Host-towbar-session"
    : "towbar-session";

export const requireAuthenticatedUser: MiddlewareHandler<
  TowbarHonoEnvironment
> = async (context, next) => {
  const token = getCookie(context, sessionCookieName);
  if (!token) throw unauthorized();
  const identity = await findSession(token);
  if (!identity) throw unauthorized("Your session has expired. Sign in again");
  context.set("user", identity.user);
  context.set("currentSessionId", identity.sessionId);
  await next();
};

export const requireTrustedMutationOrigin: MiddlewareHandler = async (
  context,
  next,
) => {
  if (["GET", "HEAD", "OPTIONS"].includes(context.req.method.toUpperCase())) {
    await next();
    return;
  }
  const origin = context.req.header("origin");
  const allowed = new Set([new URL(getEnv().TOWBAR_APP_BASE_URL).origin]);
  if (!origin || !allowed.has(origin)) {
    throw forbidden("Request origin is not allowed");
  }
  await next();
};
