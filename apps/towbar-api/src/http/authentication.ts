import { getEnv } from "../env.js";
import { findSession } from "../areas/auth/service.js";
import { forbidden, unauthorized } from "./errors.js";

import type { MiddlewareHandler } from "hono";
import type { TowbarHonoEnvironment } from "./types.js";

export const requireAuthenticatedUser: MiddlewareHandler<
  TowbarHonoEnvironment
> = async (context, next) => {
  const identity = await findSession(context.req.raw.headers);
  if (!identity) throw unauthorized("Your session has expired. Sign in again");
  context.set("user", identity.user);
  context.set("actor", {
    kind: "session",
    workspaceId: identity.user.workspaceId,
    userId: identity.user.id,
    role: identity.user.workspaceRole,
  });
  context.set("currentSessionId", identity.sessionId);
  if (
    identity.user.mustChangePassword &&
    !["/v1/core/session", "/v1/core/profile/password"].includes(
      context.req.path.replace(/\/$/, ""),
    )
  )
    throw forbidden("Change your temporary password to continue");
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
