import { hashOpaqueToken } from "@workspace/towbar-core/security";
import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import {
  apiKeys,
  auditEvents,
  authRateLimitBuckets,
  servers,
  sessions,
  users,
  workspaceMembers,
  workspaces,
} from "@workspace/towbar-database/schema";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
const url = process.env.TOWBAR_TEST_DATABASE_URL;
void test(
  "API and MCP enforce persistent key, permission, and rate boundaries",
  { skip: !url },
  async (t) => {
    assert(url && new URL(url).pathname.endsWith("_test"));
    process.env.DATABASE_TOWBAR_URL = url;
    process.env.TOWBAR_CREDENTIALS_KEY = randomBytes(32).toString("base64");
    process.env.TOWBAR_INTERNAL_HMAC_SECRET = randomBytes(32).toString("hex");
    process.env.TOWBAR_APP_BASE_URL = "https://app.towbar.test";
    delete process.env.TOWBAR_API_RATE_LIMIT_MAX;
    delete process.env.TOWBAR_API_RATE_LIMIT_WINDOW_SECONDS;
    const bucketHash = createHmac(
      "sha256",
      process.env.TOWBAR_INTERNAL_HMAC_SECRET,
    )
      .update("auth-rate-limit:api-address:unknown")
      .digest("hex");
    const { runTowbarMigrations } =
      await import("@workspace/towbar-database/migrate");
    await runTowbarMigrations({
      databaseUrl: url,
      logger: { info() {}, error() {} },
    });
    const { getTowbarDatabase, closeDatabase } =
      await import("../../infrastructure/database.js");
    const { createApiKey, hashApiKey, listApiKeys, revokeApiKey } =
      await import("../api-keys/service.js");
    const { createApp } = await import("../../app.js");
    const { operations, createOpenApiDocument } =
      await import("./catalogue.js");
    const { mcpTools } = await import("./mcp-tools.js");
    const { operationDescription } = await import("../../http/operation.js");
    const { controlPlaneRoutes } =
      await import("../../routes/v1/core/index.js");
    const db = getTowbarDatabase(),
      app = createApp();
    const userId = randomUUID(),
      workspaceId = randomUUID(),
      otherId = randomUUID();
    await db.insert(users).values({
      id: userId,
      email: `${userId}@example.test`,
      displayName: "API test",
    });
    await db.insert(workspaces).values([
      { id: workspaceId, name: "API test", slug: workspaceId },
      { id: otherId, name: "Other workspace", slug: otherId },
    ]);
    await db
      .insert(workspaceMembers)
      .values({ userId, workspaceId, role: "owner" });
    const user = {
      id: userId,
      email: `${userId}@example.test`,
      name: "API test",
      workspaceId,
      workspaceRole: "owner" as const,
    };
    const ownedServerId = randomUUID(),
      foreignServerId = randomUUID();
    await db.insert(servers).values(
      [
        { id: ownedServerId, workspaceId, ip: "192.0.2.10" },
        { id: foreignServerId, workspaceId: otherId, ip: "192.0.2.11" },
      ].map(({ id, workspaceId, ip }) => ({
        id,
        workspaceId,
        canonicalIp: ip,
        configDigest: "test-digest",
        config: {
          ip,
          ssh: { host: ip, port: 22, username: "ubuntu" },
          buildConcurrency: 1,
        },
      })),
    );
    const write = await createApiKey(user, {
      name: "Automation",
      access: "write",
    });
    const read = await createApiKey(user, {
      name: "Read",
      access: "read",
    });
    const request = async (
      path: string,
      token?: string,
      method = "GET",
      body?: unknown,
      extra: Record<string, string> = {},
    ) =>
      await app.request(`/v1/api${path}`, {
        method,
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          "content-type": "application/json",
          ...extra,
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    async function connect(token: string) {
      const client = new Client({
        name: "towbar-integration-test",
        version: "1",
      });
      const transport = new StreamableHTTPClientTransport(
        new URL("http://localhost/v1/mcp"),
        {
          requestInit: { headers: { Authorization: `Bearer ${token}` } },
          fetch: async (input, init) => app.fetch(new Request(input, init)),
        },
      );
      await client.connect(transport);
      return client;
    }
    t.beforeEach(async () => {
      await db
        .delete(authRateLimitBuckets)
        .where(eq(authRateLimitBuckets.keyHash, bucketHash));
    });
    try {
      await t.test(
        "public operations have REST schemas and unique operation IDs; browser-only routes are excluded",
        () => {
          const routes = new Set(
            controlPlaneRoutes.routes
              .filter((r) => r.method !== "ALL")
              .map((r) => `${r.method} ${r.path}`),
          );
          const browserOnly = new Set(
            controlPlaneRoutes.routes
              .filter((r) => operationDescription(r.handler)?.browserOnly)
              .map((r) => `${r.method} ${r.path}`),
          );
          assert.equal(browserOnly.size, 16);
          for (const route of browserOnly) routes.delete(route);
          assert.deepEqual(
            new Set(operations.map((op) => `${op.method} ${op.path}`)),
            routes,
          );
          assert.equal(
            new Set(operations.map((op) => op.name)).size,
            operations.length,
          );
          assert.equal(operations.length, 107);
          assert(operations.every((op) => op.name.length <= 64));
          assert.doesNotThrow(() =>
            JSON.stringify(createOpenApiDocument("https://api.test/v1/api")),
          );
          const secrets = operations.find(
            (op) => op.path === "/settings/secrets/:environment/:stage",
          )!;
          assert(
            secrets.input.safeParse({
              path: { environment: "production", stage: "deployment" },
              body: { expectedRevision: null, set: { HELLO: "world" } },
            }).success,
          );
        },
      );
      await t.test(
        "tokens are random, hashed, and absent from metadata",
        async () => {
          assert.notEqual(write.token, read.token);
          const [stored] = await db
            .select()
            .from(apiKeys)
            .where(eq(apiKeys.id, write.key!.id));
          assert.equal(stored!.tokenHash, hashApiKey(write.token));
          assert(!JSON.stringify(stored).includes(write.token));
          const text = JSON.stringify(await listApiKeys(user));
          assert(!text.includes(write.token));
          assert(!text.includes(stored!.tokenHash));
          const audit = await db
            .select()
            .from(auditEvents)
            .where(eq(auditEvents.workspaceId, workspaceId));
          assert(
            audit.some(
              (event) =>
                event.action === "api-key.created" &&
                event.targetId === write.key.id,
            ),
          );
          assert(!JSON.stringify(audit).includes(write.token));
          assert.equal(
            (await request("/profile", write.token)).headers.get(
              "cache-control",
            ),
            "no-store",
          );
        },
      );
      await t.test(
        "bearer auth is required and browser sessions keep their origin boundary",
        async () => {
          assert.equal((await request("/apps")).status, 401);
          assert.equal((await request("/apps", "twb_invalid")).status, 401);
          assert.equal(
            (
              await request("/apps", write.token, "GET", undefined, {
                origin: "https://evil.example",
              })
            ).status,
            403,
          );
          assert.equal(
            (
              await app.request("/v1/core/apps", {
                headers: { authorization: `Bearer ${write.token}` },
              })
            ).status,
            401,
          );
          const token = randomBytes(32).toString("base64url");
          await db.insert(sessions).values({
            userId,
            tokenHash: hashOpaqueToken(token),
            expiresAt: new Date(Date.now() + 3600000),
          });
          const cookie = `towbar-session=${token}`;
          assert.equal(
            (
              await app.request("/v1/core/settings/api-keys", {
                headers: { cookie },
              })
            ).status,
            200,
          );
          assert.equal(
            (
              await app.request("/v1/core/settings/api-keys", {
                method: "POST",
                headers: { cookie, "content-type": "application/json" },
                body: JSON.stringify({
                  name: "Browser",
                  access: "read",
                }),
              })
            ).status,
            403,
          );
          const created = await app.request("/v1/core/settings/api-keys", {
            method: "POST",
            headers: {
              cookie,
              "content-type": "application/json",
              origin: "https://app.towbar.test",
            },
            body: JSON.stringify({
              name: "Browser",
              access: "read",
            }),
          });
          assert.equal(created.status, 201);
          const profile = await app.request("/v1/core/profile", {
            method: "PATCH",
            headers: {
              cookie,
              "content-type": "application/json",
              origin: "https://app.towbar.test",
            },
            body: JSON.stringify({ displayName: "Browser profile" }),
          });
          assert.equal(profile.status, 200);
          assert.equal(
            (await app.request("/v1/core/sessions", { headers: { cookie } }))
              .status,
            200,
          );
        },
      );
      await t.test(
        "browser-only actions are inaccessible to API keys and MCP",
        async () => {
          const excluded: Array<[string, string, string]> = [
            ["GET", "/notifications", "get_notifications"],
            ["GET", "/notifications/providers", "get_notifications_providers"],
            [
              "GET",
              `/sources/${randomUUID()}/notifications/destinations`,
              "get_sources_by_id_notifications_destinations",
            ],
            [
              "POST",
              `/sources/${randomUUID()}/notifications/destinations`,
              "post_sources_by_id_notifications_destinations",
            ],
            [
              "PUT",
              `/sources/${randomUUID()}/notifications/destinations/${randomUUID()}`,
              "put_sources_by_id_notifications_destinations_by_id",
            ],
            [
              "DELETE",
              `/sources/${randomUUID()}/notifications/destinations/${randomUUID()}`,
              "delete_sources_by_id_notifications_destinations_by_id",
            ],
            [
              "POST",
              `/sources/${randomUUID()}/notifications/destinations/${randomUUID()}/actions/test`,
              "post_sources_by_id_notifications_destinations_by_id_actions_test",
            ],
            ["GET", "/settings/api-keys", "get_settings_api_keys"],
            ["POST", "/settings/api-keys", "post_settings_api_keys"],
            [
              "DELETE",
              `/settings/api-keys/${write.key.id}`,
              "delete_settings_api_keys_by_id",
            ],
            ["PATCH", "/profile", "patch_profile"],
            ["PUT", "/profile/password", "put_profile_password"],
            ["GET", "/sessions", "get_sessions"],
            ["DELETE", `/sessions/${randomUUID()}`, "delete_sessions_by_id"],
            [
              "POST",
              "/github/actions/installation-url",
              "post_github_actions_installation_url",
            ],
            [
              "POST",
              "/github/actions/complete-installation",
              "post_github_actions_complete_installation",
            ],
          ];
          const client = await connect(write.token);
          try {
            const tools = await client.listTools();
            const spec = createOpenApiDocument("https://api.test/v1/api");
            for (const [method, path, name] of excluded) {
              assert.equal(
                (await request(path, write.token, method)).status,
                404,
              );
              assert(!tools.tools.some((tool) => tool.name === name));
              assert(
                !JSON.stringify(spec.paths).includes(`"operationId":"${name}"`),
              );
              assert.equal(
                (await client.callTool({ name, arguments: {} })).isError,
                true,
              );
            }
          } finally {
            await client.close();
          }
        },
      );
      await t.test(
        "read-only, ownership, expiry, revocation, and live role checks",
        async () => {
          assert.equal((await request("/profile", read.token)).status, 200);
          assert.equal(
            (
              await request(
                "/settings/secrets/preview/build",
                read.token,
                "PATCH",
                {
                  expectedRevision: null,
                  set: { API_TEST: "Forbidden" },
                },
              )
            ).status,
            403,
          );
          assert.equal(
            (
              await request(
                "/settings/secrets/preview/build",
                write.token,
                "PATCH",
                {
                  expectedRevision: null,
                  set: { API_TEST: "Via API" },
                },
              )
            ).status,
            200,
          );
          assert.equal(
            (await request("/servers/not-a-uuid", write.token)).status,
            400,
          );
          const otherKey = await createApiKey(
            { ...user, workspaceId: otherId },
            { name: "Other", access: "read" },
          );
          await assert.rejects(() => revokeApiKey(user, otherKey.key.id));
          assert.equal((await request("/profile", otherKey.token)).status, 401);
          const expiring = await createApiKey(user, {
            name: "Expired",
            access: "read",
            expiresAt: new Date(Date.now() - 1000).toISOString(),
          });
          assert.equal((await request("/profile", expiring.token)).status, 401);
          await db
            .update(workspaceMembers)
            .set({ role: "member" })
            .where(eq(workspaceMembers.userId, userId));
          assert.equal(
            (await request("/aws", write.token, "DELETE")).status,
            403,
          );
          const memberClient = await connect(write.token);
          try {
            const available = await memberClient.listTools();
            assert(
              !available.tools.some(
                (tool) => tool.name === "towbar_secrets_update",
              ),
            );
            assert.equal(
              (
                await memberClient.callTool({
                  name: "towbar_secrets_update",
                  arguments: {
                    scope: "workspace",
                    environment: "preview",
                    stage: "build",
                    expectedRevision: null,
                    set: { DENIED: "No" },
                  },
                })
              ).isError,
              true,
            );
          } finally {
            await memberClient.close();
          }
          await db
            .update(workspaceMembers)
            .set({ role: "owner" })
            .where(eq(workspaceMembers.userId, userId));
          await db
            .update(users)
            .set({ disabledAt: new Date() })
            .where(eq(users.id, userId));
          assert.equal((await request("/profile", write.token)).status, 401);
          await db
            .update(users)
            .set({ disabledAt: null })
            .where(eq(users.id, userId));
        },
      );
      await t.test(
        "official MCP client initializes, lists tools, reads and mutates through shared handlers",
        async () => {
          const client = await connect(write.token);
          try {
            const list = await client.listTools();
            assert.equal(list.tools.length, mcpTools.length);
            assert.equal(
              (await client.callTool({ name: "get_apps", arguments: {} }))
                .isError,
              true,
            );
            const profile = await client.callTool({
              name: "towbar_inventory_search",
              arguments: { kind: "app" },
            });
            assert.equal(profile.isError, false);
            const foundServer = await client.callTool({
              name: "towbar_inventory_search",
              arguments: { kind: "server", search: "192.0.2." },
            });
            const { result: searchResult } = foundServer.structuredContent as {
              result: { items: Array<{ id: string; canonicalIp: string }> };
            };
            assert.deepEqual(
              searchResult.items.map((item) => item.id),
              [ownedServerId],
            );
            assert.equal(searchResult.items[0]!.canonicalIp, "192.0.2.10");
            const foreign = await client.callTool({
              name: "towbar_server_inspect",
              arguments: { serverId: foreignServerId },
            });
            assert.equal(foreign.isError, true);
            assert(!JSON.stringify(foreign).includes("192.0.2.11"));

            const invalid = await client.callTool({
              name: "towbar_server_inspect",
              arguments: { serverId: "../../internal" },
            });
            assert.equal(invalid.isError, true);
            const secret = await client.callTool({
              name: "towbar_secrets_update",
              arguments: {
                scope: "workspace",
                environment: "production",
                stage: "deployment",
                expectedRevision: null,
                set: { TEST_VALUE: "do-not-expose" },
              },
            });
            assert.equal(secret.isError, false);
            assert(!JSON.stringify(secret).includes("do-not-expose"));
            const readback = await (
              await request("/settings/secrets", write.token)
            ).text();
            assert(readback.includes("TEST_VALUE"));
            assert(!readback.includes("do-not-expose"));
          } finally {
            await client.close();
          }
          const reader = await connect(read.token);
          try {
            const tools = await reader.listTools();
            assert(tools.tools.every((tool) => tool.annotations?.readOnlyHint));
            assert.equal(
              (
                await reader.callTool({
                  name: "towbar_secrets_update",
                  arguments: {
                    scope: "workspace",
                    environment: "preview",
                    stage: "deployment",
                    expectedRevision: null,
                    set: { DENIED: "No" },
                  },
                })
              ).isError,
              true,
            );
            await revokeApiKey(user, read.key.id);
            await assert.rejects(() => reader.listTools());
          } finally {
            await reader.close();
          }
        },
      );
      await t.test(
        "default 60 per-IP window is shared by API and MCP and cannot be spoofed",
        async () => {
          await db
            .delete(authRateLimitBuckets)
            .where(eq(authRateLimitBuckets.keyHash, bucketHash));
          const results = await Promise.all(
            Array.from({ length: 60 }, (_, i) =>
              request("/profile", write.token, "GET", undefined, {
                "x-forwarded-for": `192.0.2.${i}`,
              }),
            ),
          );
          assert(results.every((result) => result.status === 200));
          const limited = await request("/profile", write.token);
          assert.equal(limited.status, 429);
          assert(Number(limited.headers.get("retry-after")) > 0);
          assert.equal(limited.headers.get("x-ratelimit-remaining"), "0");
          const mcp = await app.request("/v1/mcp", {
            method: "POST",
            headers: {
              authorization: `Bearer ${write.token}`,
              "content-type": "application/json",
            },
            body: "{}",
          });
          assert.equal(mcp.status, 429);
          await db
            .update(authRateLimitBuckets)
            .set({ expiresAt: new Date(Date.now() - 1) })
            .where(eq(authRateLimitBuckets.keyHash, bucketHash));
          assert.equal((await request("/profile", write.token)).status, 200);
        },
      );
    } finally {
      await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
      await db.delete(workspaces).where(eq(workspaces.id, otherId));
      await db.delete(users).where(eq(users.id, userId));
      await db
        .delete(authRateLimitBuckets)
        .where(eq(authRateLimitBuckets.keyHash, bucketHash));
      await closeDatabase();
    }
  },
);
