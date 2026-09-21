import type { Context, Next } from "hono";

import { getEnv } from "../env.js";
import { notFound } from "./errors.js";

export function hasHttpsExternalAccess(
  apiBaseUrl = getEnv().TOWBAR_API_BASE_URL,
) {
  return new URL(apiBaseUrl).protocol === "https:";
}

export async function requireHttpsExternalAccess(
  _context: Context,
  next: Next,
) {
  if (!hasHttpsExternalAccess()) throw notFound("Route");
  await next();
}
