import { createHash } from "node:crypto";

import { HttpError } from "./errors.js";

import type { MiddlewareHandler } from "hono";

const loginWindowMs = 15 * 60 * 1_000;
const loginAttemptLimit = 20;
const windows = new Map<string, { count: number; expiresAt: number }>();

export const limitPasswordLogin: MiddlewareHandler = async (context, next) => {
  const now = Date.now();
  const key = clientKey(context.req.raw.headers);
  const current = windows.get(key);
  const window =
    !current || current.expiresAt <= now
      ? { count: 0, expiresAt: now + loginWindowMs }
      : current;

  if (window.count >= loginAttemptLimit) {
    context.header(
      "retry-after",
      String(Math.max(1, Math.ceil((window.expiresAt - now) / 1_000))),
    );
    throw new HttpError(
      429,
      "LOGIN_RATE_LIMITED",
      "Too many sign-in attempts. Try again later",
    );
  }

  window.count += 1;
  windows.set(key, window);
  pruneExpiredWindows(now);
  await next();
};

function clientKey(headers: Headers) {
  const address =
    headers.get("cf-connecting-ip") ??
    headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() ??
    "unknown";
  return createHash("sha256").update(address, "utf8").digest("hex");
}

function pruneExpiredWindows(now: number) {
  if (windows.size < 1_000) return;
  for (const [key, window] of windows) {
    if (window.expiresAt <= now) windows.delete(key);
  }
}
