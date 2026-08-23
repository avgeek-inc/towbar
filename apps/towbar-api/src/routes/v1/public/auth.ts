import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { z } from "zod";

import {
  authenticatePassword,
  exchangeAuthorizationCode,
  findSession,
  resetPassword,
  sessionLifetimeSeconds,
} from "../../../areas/auth/service.js";
import { getEnv } from "../../../env.js";
import { sessionCookieName } from "../../../http/authentication.js";
import { limitPasswordLogin } from "../../../http/rate-limit.js";
import { readJson } from "../../../http/requests.js";

const loginSchema = z
  .object({
    email: z.string().email().max(320),
    password: z.string().min(12).max(1_024),
    redirectUri: z.string().url(),
  })
  .strict();

const exchangeSchema = z
  .object({
    authorizationCode: z.string().min(20).max(1_000),
    redirectUri: z.string().url(),
  })
  .strict();
const resetSchema = z
  .object({
    confirmPassword: z.string().min(12).max(1_024),
    newPassword: z.string().min(12).max(1_024),
    token: z.string().min(20).max(1_000),
  })
  .refine((input) => input.newPassword === input.confirmPassword, {
    message: "New passwords do not match",
    path: ["confirmPassword"],
  })
  .strict();

export const publicAuthRoutes = new Hono();

publicAuthRoutes.post("/login-email", limitPasswordLogin, async (context) => {
  const input = await readJson(context, loginSchema);
  const result = await authenticatePassword(input);
  return context.json(result);
});

publicAuthRoutes.post("/exchange-code", async (context) => {
  const input = await readJson(context, exchangeSchema);
  const result = await exchangeAuthorizationCode(input);
  setCookie(context, sessionCookieName, result.sessionToken, {
    httpOnly: true,
    maxAge: sessionLifetimeSeconds,
    path: "/",
    sameSite: "Lax",
    secure: getEnv().NODE_ENV === "production",
  });
  return context.json({ user: result.user });
});

publicAuthRoutes.post("/forgot-password", (context) =>
  context.json(
    {
      accepted: true,
      message:
        "Towbar is private. Ask an administrator to create a recovery token.",
    },
    202,
  ),
);

publicAuthRoutes.post("/reset-password", async (context) => {
  await resetPassword(await readJson(context, resetSchema));
  return context.body(null, 204);
});

publicAuthRoutes.post("/refresh", async (context) => {
  const token = getCookie(context, sessionCookieName);
  const identity = token ? await findSession(token) : null;
  if (!identity || !token) return context.json({ user: null }, 401);
  setCookie(context, sessionCookieName, token, {
    httpOnly: true,
    maxAge: sessionLifetimeSeconds,
    path: "/",
    sameSite: "Lax",
    secure: getEnv().NODE_ENV === "production",
  });
  return context.json({ user: identity.user });
});
