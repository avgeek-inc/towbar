import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { sessions, users } from "@workspace/towbar-database/schema";
import { Hono } from "hono";
import { normalizeError } from "../../http/error-response.js";
import type { TowbarHonoEnvironment } from "../../http/types.js";
import type { WorkspaceRole } from "@workspace/towbar-access";
import { upgradeRoutes } from "../../routes/v1/core/upgrades.js";

function app(
  role: WorkspaceRole,
  apiKey = false,
  sessionId: string | null = null,
  userId = "00000000-0000-4000-8000-000000000001",
) {
  const app = new Hono<TowbarHonoEnvironment>();
  app.use("*", async (context, next) => {
    context.set("actor", {
      kind: "session",
      role,
      userId,
      workspaceId: "00000000-0000-4000-8000-000000000002",
    });
    context.set("currentSessionId", sessionId);
    if (apiKey) context.set("apiKey", { id: "key", access: "edit" });
    await next();
  });
  app.onError((error, context) => {
    const result = normalizeError(error);
    return context.json(result, result.status);
  });
  app.route("/", upgradeRoutes);
  return app;
}
void test("only browser Admins can reach host upgrades", async () => {
  for (const role of ["member", "viewer"] as const) {
    for (const path of ["/", "/plan", "/jobs"]) {
      const response = await app(role).request(path, {
        method: path === "/" ? "GET" : "POST",
      });
      assert.equal(response.status, 403);
    }
  }
  assert.equal((await app("admin", true).request("/")).status, 404);
  assert.equal(
    (await app("admin", true).request("/jobs", { method: "POST" })).status,
    404,
  );
});
void test("upgrade mutations require recent browser authentication", async () => {
  for (const path of ["/plan", "/jobs"])
    assert.equal(
      (await app("admin").request(path, { method: "POST" })).status,
      401,
    );
});
void test("unsupported installations retain the CLI path", async () => {
  delete process.env.TOWBAR_HOST_UPGRADES;
  const response = await app("admin").request("/");
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    supported: boolean;
    reason: string;
  };
  assert.equal(body.supported, false);
  assert.match(body.reason, /sudo towbar upgrade/u);
});

void test(
  "stale Admin sessions cannot prepare or start; fresh sessions validate targets before the host call",
  { skip: !process.env.TOWBAR_TEST_DATABASE_URL },
  async () => {
    const databaseUrl = process.env.TOWBAR_TEST_DATABASE_URL!;
    assert(new URL(databaseUrl).pathname.endsWith("_test"));
    process.env.DATABASE_TOWBAR_URL = databaseUrl;
    process.env.TOWBAR_CREDENTIALS_KEY = randomBytes(32).toString("base64");
    process.env.TOWBAR_INTERNAL_HMAC_SECRET = randomBytes(32).toString("hex");
    const { runTowbarMigrations } =
      await import("@workspace/towbar-database/migrate");
    await runTowbarMigrations({
      databaseUrl,
      logger: { info() {}, error() {} },
    });
    const { getTowbarDatabase, closeDatabase } =
      await import("../../infrastructure/database.js");
    const database = getTowbarDatabase();
    const userId = randomUUID();
    const sessionId = randomUUID();
    try {
      await database.insert(users).values({
        id: userId,
        email: `${userId}@example.test`,
        displayName: "Upgrade test",
      });
      await database.insert(sessions).values({
        id: sessionId,
        userId,
        token: randomUUID(),
        expiresAt: new Date(Date.now() + 3600000),
        authenticatedAt: new Date(0),
      });
      const application = app("admin", false, sessionId, userId);
      for (const path of ["/plan", "/jobs"]) {
        const response = await application.request(path, {
          method: "POST",
          body: "{}",
          headers: { "content-type": "application/json" },
        });
        assert.equal(response.status, 403);
        assert.equal(
          ((await response.json()) as { code: string }).code,
          "REAUTHENTICATION_REQUIRED",
        );
      }
      await database
        .update(sessions)
        .set({ authenticatedAt: new Date() })
        .where(eq(sessions.id, sessionId));
      for (const targetVersion of ["latest", "v2.0.17-rc.1", "v2.0.17; id"]) {
        const response = await application.request("/plan", {
          method: "POST",
          body: JSON.stringify({ targetVersion }),
          headers: { "content-type": "application/json" },
        });
        assert.equal(response.status, 400);
      }
      const response = await application.request("/plan", {
        method: "POST",
        body: JSON.stringify({ targetVersion: "v2.0.17" }),
        headers: { "content-type": "application/json" },
      });
      assert.equal(response.status, 409);
    } finally {
      await database.delete(users).where(eq(users.id, userId));
      await closeDatabase();
    }
  },
);
