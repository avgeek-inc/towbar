import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { ZodError } from "zod";
import { HttpError } from "../../../http/errors.js";
import type { TowbarHonoEnvironment } from "../../../http/types.js";
import { notificationCenterRoutes } from "./notification-center.js";

function app({ apiKey = false, signedIn = true } = {}) {
  const router = new Hono<TowbarHonoEnvironment>();
  router.onError((error, context) =>
    context.json(
      { error: error.message },
      error instanceof HttpError
        ? error.status
        : error instanceof ZodError
          ? 400
          : 500,
    ),
  );
  router.use("*", async (context, next) => {
    const userId = "11111111-1111-4111-8111-111111111111";
    const workspaceId = "22222222-2222-4222-8222-222222222222";
    context.set("actor", {
      kind: "session",
      role: "admin",
      userId,
      workspaceId,
    });
    context.set(
      "user",
      signedIn
        ? {
            id: userId,
            workspaceId,
            workspaceRole: "admin",
            email: "test@example.test",
            name: "Test",
          }
        : {
            id: null,
            email: null,
            name: "API key",
            workspaceId,
            workspaceRole: null,
            capabilities: [],
          },
    );
    context.set("apiKey", apiKey ? { id: userId, access: "read" } : undefined);
    await next();
  });
  router.route("/notifications", notificationCenterRoutes);
  return router;
}

void test("personal notification state is browser-session only", async () => {
  for (const [path, method] of [
    ["/notifications", "GET"],
    ["/notifications/read-all", "POST"],
  ] as const) {
    assert.equal(
      (await app({ apiKey: true }).request(path, { method })).status,
      404,
    );
    assert.equal(
      (await app({ signedIn: false }).request(path, { method })).status,
      401,
    );
  }
});
void test("notification routes reject caller-selected owners and invalid cursor bounds", async () => {
  const router = app();
  for (const query of [
    "userId=11111111-1111-4111-8111-111111111111",
    "workspaceId=22222222-2222-4222-8222-222222222222",
    "limit=101",
    "beforeId=11111111-1111-4111-8111-111111111111",
  ]) {
    assert.equal((await router.request(`/notifications?${query}`)).status, 400);
  }
  const response = await router.request("/notifications/read-all", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId: "11111111-1111-4111-8111-111111111111" }),
  });
  assert.equal(response.status, 400);
});
