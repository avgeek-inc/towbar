import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { transactionalEmails } from "@workspace/towbar-database/schema";
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
