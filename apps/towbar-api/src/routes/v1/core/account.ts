import { Hono } from "hono";
import { z } from "zod";

import {
  changePassword,
  listUserSessions,
  revokeUserSession,
  updateProfile,
} from "../../../areas/auth/service.js";
import { readJson } from "../../../http/requests.js";

import type { TowbarHonoEnvironment } from "../../../http/types.js";

const profileSchema = z
  .object({ displayName: z.string().trim().min(1).max(120) })
  .strict();
const passwordSchema = z
  .object({
    currentPassword: z.string().min(12).max(1_024),
    confirmPassword: z.string().min(12).max(1_024),
    newPassword: z.string().min(12).max(1_024),
  })
  .refine((input) => input.newPassword === input.confirmPassword, {
    message: "New passwords do not match",
    path: ["confirmPassword"],
  })
  .strict();
export const accountRoutes = new Hono<TowbarHonoEnvironment>();

accountRoutes.get("/sessions", async (context) =>
  context.json({
    currentSessionId: context.get("currentSessionId"),
    sessions: await listUserSessions(context.get("user").id),
  }),
);
accountRoutes.delete("/sessions/:sessionId", async (context) => {
  const sessionId = context.req.param("sessionId");
  await revokeUserSession({
    currentSessionId: context.get("currentSessionId"),
    sessionId,
    userId: context.get("user").id,
  });
  return context.body(null, 204);
});
accountRoutes.get("/profile", (context) =>
  context.json({ user: context.get("user") }),
);
accountRoutes.patch("/profile", async (context) => {
  const body = await readJson(context, profileSchema);
  const currentUser = context.get("user");
  const updatedUser = await updateProfile({
    displayName: body.displayName,
    userId: currentUser.id,
  });
  return context.json({
    user: {
      ...updatedUser,
      workspaceId: currentUser.workspaceId,
      workspaceRole: currentUser.workspaceRole,
    },
  });
});
accountRoutes.put("/profile/password", async (context) => {
  const body = await readJson(context, passwordSchema);
  await changePassword({
    currentSessionId: context.get("currentSessionId"),
    currentPassword: body.currentPassword,
    newPassword: body.newPassword,
    userId: context.get("user").id,
  });
  return context.body(null, 204);
});
