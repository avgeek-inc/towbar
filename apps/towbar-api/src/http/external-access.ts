import type { Context, Next } from "hono";

import { getEnv } from "../env.js";
import { notFound } from "./errors.js";

export function hasHttpsExternalAccess(
  appBaseUrl = getEnv().TOWBAR_APP_BASE_URL,
) {
  return new URL(appBaseUrl).protocol === "https:";
}

export async function requireHttpsExternalAccess(
  _context: Context,
  next: Next,
) {
  if (!hasHttpsExternalAccess()) throw notFound("Route");
  await next();
}
