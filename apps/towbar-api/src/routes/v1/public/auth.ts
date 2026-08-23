import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { z } from "zod";

import {
  authenticatePassword,
  createInitialOwner,
  findSession,
  getInitialSetupStatus,
  sessionLifetimeSeconds,
} from "../../../areas/auth/service.js";
import { getEnv } from "../../../env.js";
import {
  requireTrustedMutationOrigin,
  sessionCookieName,
} from "../../../http/authentication.js";
import {
  clearPasswordLoginAccountRateLimit,
  enforceInitialSetupRateLimit,
  enforcePasswordLoginRateLimit,
  getClientAddress,
} from "../../../http/rate-limit.js";
import { readJson } from "../../../http/requests.js";

const loginSchema = z
  .object({
    email: z.string().email().max(320),
    password: z.string().min(12).max(1_024),
  })
  .strict();
const setupSchema = z
  .object({
    confirmPassword: z.string().min(12).max(1_024),
    displayName: z.string().trim().min(1).max(120),
    email: z.string().email().max(320),
    password: z.string().min(12).max(1_024),
  })
  .refine((input) => input.password === input.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  })
  .strict();

export const publicAuthRoutes = new Hono();
publicAuthRoutes.use("*", requireTrustedMutationOrigin);

publicAuthRoutes.get("/setup-status", async (context) =>
  context.json(await getInitialSetupStatus()),
);

publicAuthRoutes.post("/setup", async (context) => {
  const input = await readJson(context, setupSchema);
  await enforceInitialSetupRateLimit(getClientAddress(context));
  const result = await createInitialOwner(input);
  setSessionCookie(context, result.sessionToken);
  return context.json({ user: result.user }, 201);
});

publicAuthRoutes.post("/login-email", async (context) => {
  const input = await readJson(context, loginSchema);
  await enforcePasswordLoginRateLimit({
    clientAddress: getClientAddress(context),
    email: input.email,
  });
  const result = await authenticatePassword(input);
  await clearPasswordLoginAccountRateLimit(input.email);
  setSessionCookie(context, result.sessionToken);
  return context.json({ user: result.user });
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

function setSessionCookie(
  context: Parameters<typeof setCookie>[0],
  sessionToken: string,
) {
  setCookie(context, sessionCookieName, sessionToken, {
    httpOnly: true,
    maxAge: sessionLifetimeSeconds,
    path: "/",
    sameSite: "Lax",
    secure: getEnv().NODE_ENV === "production",
  });
}
