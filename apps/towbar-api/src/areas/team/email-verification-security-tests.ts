import assert from "node:assert/strict";
import { and, eq, lt } from "drizzle-orm";
import {
  authRateLimitBuckets,
  transactionalEmails,
  users,
} from "@workspace/towbar-database/schema";
import type { getTowbarDatabase } from "../../infrastructure/database.js";
import type { settingsTestClient } from "./settings-test-client.js";

export async function verifyEmailResendLimits({
  database,
  client,
  headers,
  publicHeaders,
  email,
}: {
  database: ReturnType<typeof getTowbarDatabase>;
  client: ReturnType<typeof settingsTestClient>;
  headers: Headers;
  publicHeaders: Headers;
  email: string;
}) {
  const endpoint = "/v1/public/auth/identity/send-verification-email";
  const { request } = client;
  const condition = and(
    eq(transactionalEmails.recipient, email),
    eq(transactionalEmails.template, "email-verification"),
  );
  const mails = () =>
    database.select().from(transactionalEmails).where(condition);
  const age = (milliseconds: number) =>
    database
      .update(transactionalEmails)
      .set({ createdAt: new Date(Date.now() - milliseconds) })
      .where(condition);
  assert.equal((await request(endpoint, publicHeaders, { email })).status, 403);
  assert.equal(
    (await request(endpoint, headers, { email: "someone-else@settings.test" }))
      .status,
    400,
  );
  assert.equal((await mails()).length, 0);
  const concurrent = await Promise.all([
    request(endpoint, headers, { email }),
    request(endpoint, headers, { email }),
  ]);
  assert.deepEqual(concurrent.map((r) => r.status).sort(), [200, 429]);
  assert.equal((await mails()).length, 1);
  for (let count = 2; count <= 5; count++) {
    await age(61_000);
    const sent = await request(endpoint, headers, { email });
    assert.equal(sent.status, 200, await sent.text());
    assert.equal((await mails()).length, count);
  }
  await age(61_000);
  const limited = await request(endpoint, headers, { email });
  assert.equal(limited.status, 429);
  assert.match(await limited.text(), /5 confirmation emails/);
  assert.equal((await mails()).length, 5);
  await age(24 * 60 * 60_000 + 1_000);
  assert.equal((await request(endpoint, headers, { email })).status, 200);
  assert.equal((await mails()).length, 6);
}

export async function verifyPublicEmailResend({
  database,
  client,
  headers,
  publicHeaders,
  email,
  memberEmail,
}: {
  database: ReturnType<typeof getTowbarDatabase>;
  client: ReturnType<typeof settingsTestClient>;
  headers: Headers;
  publicHeaders: Headers;
  email: string;
  memberEmail: string;
}) {
  const endpoint = "/v1/public/auth/request-verification-email";
  const request = (target: string, requestHeaders = publicHeaders) =>
    client.request(endpoint, requestHeaders, { email: target });
  const count = async () =>
    (
      await database
        .select()
        .from(transactionalEmails)
        .where(eq(transactionalEmails.template, "email-verification"))
    ).length;
  const expireMinute = () =>
    database
      .update(authRateLimitBuckets)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(lt(authRateLimitBuckets.expiresAt, new Date(Date.now() + 61_000)));
  const accepted = async (target: string, requestHeaders = publicHeaders) => {
    const response = await request(target, requestHeaders);
    assert.equal(response.status, 200, await response.clone().text());
    assert.deepEqual(await response.json(), { status: true });
    assert.equal(response.headers.get("set-cookie"), null);
  };
  const before = await count();
  await accepted("unknown-public@settings.test", headers);
  assert.equal(await count(), before);
  await database
    .update(transactionalEmails)
    .set({ createdAt: new Date(Date.now() - 24 * 60 * 60_000 - 1000) })
    .where(eq(transactionalEmails.template, "email-verification"));
  await accepted(email.toUpperCase());
  assert.equal(await count(), before + 1);
  const duplicate = await request(email);
  assert.equal(duplicate.status, 429);
  assert.ok(Number(duplicate.headers.get("retry-after")) > 0);
  assert.equal((await request("unknown-public@settings.test")).status, 429);
  await database
    .update(users)
    .set({ emailVerified: true })
    .where(eq(users.email, memberEmail));
  await accepted(memberEmail, headers);
  assert.equal(await count(), before + 1);
  await database
    .update(users)
    .set({ emailVerified: false, disabledAt: new Date() })
    .where(eq(users.email, memberEmail));
  await expireMinute();
  await accepted(memberEmail);
  assert.equal(await count(), before + 1);
  await database
    .update(users)
    .set({ disabledAt: null })
    .where(eq(users.email, memberEmail));
  const budgetEmail = "public-budget@settings.test";
  for (let attempt = 0; attempt < 5; attempt++) {
    await expireMinute();
    await accepted(budgetEmail);
  }
  await expireMinute();
  assert.equal((await request(budgetEmail)).status, 429);
  assert.equal(await count(), before + 1);
  const attacker = new Headers({ origin: "https://attacker.example" });
  assert.equal((await request("another@settings.test", attacker)).status, 403);
  assert.equal(
    (await client.request(endpoint, publicHeaders, { email: "invalid" }))
      .status,
    400,
  );
  assert.equal(
    (
      await client.request(endpoint, publicHeaders, {
        email,
        callbackURL: "https://attacker.example",
      })
    ).status,
    400,
  );
  const tokenHeaders = new Headers(publicHeaders);
  tokenHeaders.set("x-api-key", "not-a-browser");
  assert.equal((await request(email, tokenHeaders)).status, 403);
}
