import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { authAccounts } from "@workspace/towbar-database/schema";
import type { AuthDatabase } from "../../infrastructure/database.js";
import type { AuthenticatedUser } from "../../http/types.js";
import type { createApp } from "../../app.js";
export async function assertBrowserSessionBoundary({
  db,
  app,
  userId,
  user,
}: {
  db: AuthDatabase;
  app: ReturnType<typeof createApp>;
  userId: string;
  user: AuthenticatedUser;
}) {
  const password = "Browser integration passphrase 61794";
  await db.insert(authAccounts).values({
    userId,
    providerId: "credential",
    accountId: userId,
    password: await hashPassword(password),
  });
  const { getIdentityAuth } = await import("../auth/identity.js");
  const login = await getIdentityAuth().api.signInEmail({
    body: { email: user.email, password },
    asResponse: true,
  });
  assert.equal(login.status, 200);
  const cookie = login.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  assert.equal(
    (
      await app.request("/v1/core/settings/api-keys/personal", {
        headers: { cookie },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await app.request("/v1/core/settings/api-keys/personal", {
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
  const created = await app.request("/v1/core/settings/api-keys/personal", {
    method: "POST",
    headers: {
      cookie,
      "content-type": "application/json",
      origin: "https://app.towbar.test",
      "Idempotency-Key": randomUUID(),
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
      "Idempotency-Key": randomUUID(),
    },
    body: JSON.stringify({ displayName: "Browser profile" }),
  });
  assert.equal(profile.status, 200);
  assert.equal(
    (await app.request("/v1/core/sessions", { headers: { cookie } })).status,
    200,
  );
}
