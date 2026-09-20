import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import type { TestContext } from "node:test";
import { and, eq } from "drizzle-orm";
import * as schema from "@workspace/towbar-database/schema";
import { getEnv } from "../../env.js";
import type { AuthDatabase } from "../../infrastructure/database.js";
import type { AuthenticatedUser } from "../../http/types.js";
import * as auth from "../auth/service.js";
import * as teams from "./service.js";
export async function assertAuthenticationSecurity({
  t,
  database,
  admin,
  adminHeaders,
  password,
  updatedPassword,
  request,
  headersFor,
  origin,
}: {
  t: TestContext;
  database: AuthDatabase;
  admin: AuthenticatedUser;
  adminHeaders: Headers;
  password: string;
  updatedPassword: string;
  origin: string;
  request: (
    path: string,
    headers: Headers,
    body?: unknown,
    method?: string,
  ) => Response | Promise<Response>;
  headersFor: (response: Response) => Headers;
}) {
  await t.test(
    "MFA enrollment, challenges, one-use recovery, and recent authentication",
    async () => {
      const enabled = await request(
        "/v1/public/auth/identity/two-factor/enable",
        adminHeaders,
        { password },
      );
      assert.equal(enabled.status, 200, await enabled.clone().text());
      const factor = (await enabled.json()) as {
        totpURI: string;
        backupCodes: string[];
      };
      const secret = new URL(factor.totpURI).searchParams.get("secret");
      assert(secret);
      const confirmed = await request(
        "/v1/public/auth/identity/two-factor/verify-totp",
        adminHeaders,
        { code: totp(secret) },
      );
      assert.equal(confirmed.status, 200, await confirmed.clone().text());
      for (const value of confirmed.headers.getSetCookie())
        if (value.startsWith("towbar-session="))
          adminHeaders.set("cookie", value.split(";")[0]!);
      assert.equal(
        (await auth.findSession(adminHeaders))!.user.twoFactorEnabled,
        true,
      );
      const login = await request(
        "/v1/public/auth/login-email",
        new Headers({ origin }),
        { email: admin.email, password },
      );
      assert.equal(
        ((await login.clone().json()) as { twoFactorRequired: boolean })
          .twoFactorRequired,
        true,
      );
      assert.deepEqual(
        ((await login.clone().json()) as { twoFactorMethods: string[] })
          .twoFactorMethods,
        ["totp"],
      );
      assert.equal(await auth.findSession(headersFor(login)), null);
      const challenge = headersFor(login);
      const recovery = await request(
        "/v1/public/auth/identity/two-factor/verify-backup-code",
        challenge,
        { code: factor.backupCodes[0] },
      );
      assert.equal(recovery.status, 200, await recovery.clone().text());
      assert.equal(
        (await auth.findSession(headersFor(recovery)))!.user.id,
        admin.id,
      );
      const nextLogin = await request(
        "/v1/public/auth/login-email",
        new Headers({ origin }),
        { email: admin.email, password },
      );
      const reused = await request(
        "/v1/public/auth/identity/two-factor/verify-backup-code",
        headersFor(nextLogin),
        { code: factor.backupCodes[0] },
      );
      assert.equal(reused.ok, false);
      const session = (await auth.findSession(adminHeaders))!;
      await database
        .update(schema.sessions)
        .set({ authenticatedAt: new Date(Date.now() - 11 * 60_000) })
        .where(eq(schema.sessions.id, session.sessionId));
      const stale = await request(
        "/v1/public/auth/identity/two-factor/disable",
        adminHeaders,
        { password },
      );
      assert.equal(stale.status, 403);
      const recent = await request(
        "/v1/core/session/reauthenticate",
        adminHeaders,
        { password, code: totp(secret) },
      );
      assert.equal(recent.ok, true, await recent.clone().text());
      const disabled = await request(
        "/v1/public/auth/identity/two-factor/disable",
        adminHeaders,
        { password },
      );
      assert.equal(disabled.status, 200, await disabled.clone().text());
      for (const value of disabled.headers.getSetCookie())
        if (value.startsWith("towbar-session="))
          adminHeaders.set("cookie", value.split(";")[0]!);
      assert.equal(
        (await auth.findSession(adminHeaders))!.user.twoFactorEnabled,
        false,
      );
    },
  );
  await t.test(
    "password recovery is single-use and revokes existing sessions",
    async () => {
      const user = await teams.createTeamMember(admin, {
        name: "Recovery",
        email: "recover@example.test",
        password,
        role: "viewer",
      });
      const before = headersFor(
        await auth.authenticatePassword({
          email: "recover@example.test",
          password,
        }),
      );
      const response = await request(
        "/v1/public/auth/identity/request-password-reset",
        new Headers({ origin }),
        {
          email: "recover@example.test",
          redirectTo: `${origin}/reset-password`,
        },
      );
      assert.equal(response.status, 200, await response.clone().text());
      const unknown = await request(
        "/v1/public/auth/identity/request-password-reset",
        new Headers({ origin }),
        {
          email: "unknown@example.test",
          redirectTo: `${origin}/reset-password`,
        },
      );
      assert.deepEqual(await unknown.json(), await response.json());
      const [mail] = await database
        .select()
        .from(schema.transactionalEmails)
        .where(
          and(
            eq(schema.transactionalEmails.recipient, "recover@example.test"),
            eq(schema.transactionalEmails.template, "password-reset"),
          ),
        );
      assert(mail?.encryptedData);
      const { decryptCredential, parseCredentialsMasterKey } =
        await import("@workspace/towbar-core");
      const data = decryptCredential<{ actionUrl: string }>({
        associatedData: `towbar:transactional-email:${mail.workspaceId}:${mail.id}`,
        masterKey: parseCredentialsMasterKey(getEnv().TOWBAR_CREDENTIALS_KEY),
        envelope: mail.encryptedData,
      });
      const token = new URL(data.actionUrl).pathname.split("/").at(-1);
      const changed = await request(
        "/v1/public/auth/identity/reset-password",
        new Headers({ origin }),
        { token, newPassword: updatedPassword },
      );
      assert.equal(changed.status, 200, await changed.clone().text());
      assert.equal(await auth.findSession(before), null);
      assert.equal(
        (await auth.getUserIdentity(user.userId))!.mustChangePassword,
        false,
      );
      const replay = await request(
        "/v1/public/auth/identity/reset-password",
        new Headers({ origin }),
        { token, newPassword: password },
      );
      assert.equal(replay.ok, false);
      const after = headersFor(
        await auth.authenticatePassword({
          email: "recover@example.test",
          password: updatedPassword,
        }),
      );
      assert.equal((await auth.findSession(after))!.user.id, user.userId);
    },
  );
}

export function totp(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret.toUpperCase().replace(/=+$/u, "")]
    .map((character) =>
      alphabet.indexOf(character).toString(2).padStart(5, "0"),
    )
    .join("");
  const bytes = Buffer.from(
    bits.match(/.{8}/gu)!.map((byte) => parseInt(byte, 2)),
  );
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", bytes).update(counter).digest();
  const offset = digest[digest.length - 1]! & 15;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000)
    .toString()
    .padStart(6, "0");
}
