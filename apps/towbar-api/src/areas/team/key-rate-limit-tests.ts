import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { eq } from "drizzle-orm";
import { apiKeys } from "@workspace/towbar-database/schema";
import type { AuthDatabase } from "../../infrastructure/database.js";
import type { AuthenticatedUser } from "../../http/types.js";
import { HttpError } from "../../http/errors.js";
import { createApiKey, findApiKey } from "../api-keys/service.js";

export async function assertKeyRateLimits({
  t,
  database,
  admin,
  request,
}: {
  t: TestContext;
  database: AuthDatabase;
  admin: AuthenticatedUser;
  request: (path: string, headers: Headers) => Response | Promise<Response>;
}) {
  await t.test(
    "per-key request limits are atomic and return a retryable response",
    async () => {
      const limited = await createApiKey(admin, {
        name: "Rate limit proof",
        access: "read",
      });
      assert(limited.token);
      await database
        .update(apiKeys)
        .set({
          rateLimitMax: 2,
          rateLimitTimeWindow: 60_000,
          requestCount: 0,
          lastRequest: null,
        })
        .where(eq(apiKeys.id, limited.key.id));
      const results = await Promise.allSettled(
        Array.from({ length: 4 }, () => findApiKey(limited.token!)),
      );
      assert.equal(
        results.filter(
          (result) => result.status === "fulfilled" && result.value,
        ).length,
        2,
      );
      const rejected = results.filter((result) => result.status === "rejected");
      assert.equal(rejected.length, 2);
      for (const result of rejected) {
        assert(result.reason instanceof HttpError);
        assert.equal(result.reason.status, 429);
      }
      const response = await request(
        "/v1/api/identity",
        new Headers({
          authorization: `Bearer ${limited.token}`,
        }),
      );
      assert.equal(response.status, 429);
      assert(Number(response.headers.get("retry-after")) > 0);
      const independent = await createApiKey(admin, {
        name: "Independent key",
        access: "read",
      });
      assert(await findApiKey(independent.token!));
      await database
        .update(apiKeys)
        .set({ lastRequest: new Date(Date.now() - 61_000) })
        .where(eq(apiKeys.id, limited.key.id));
      assert(await findApiKey(limited.token));
    },
  );
}
