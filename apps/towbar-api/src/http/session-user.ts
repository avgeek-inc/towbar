import { forbidden } from "./errors.js";
import type { Context } from "hono";
import type { AuthenticatedUser, TowbarHonoEnvironment } from "./types.js";
export function sessionUser(
  context: Context<TowbarHonoEnvironment>,
): AuthenticatedUser {
  const user = context.get("user");
  if (
    context.get("actor")?.kind !== "session" ||
    !user.id ||
    !user.email ||
    !user.workspaceRole
  )
    throw forbidden("Use a browser session for this action");
  return user;
}
