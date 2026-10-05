import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
const url = process.env.TOWBAR_TEST_DATABASE_URL;
const folder = fileURLToPath(new URL("../drizzle", import.meta.url));
test(
  "passkey migration preserves credentials, retires TOTP and invalidates affected sessions once",
  { skip: !url },
  async () => {
    assert(new URL(url).pathname.endsWith("_test"));
    const admin = postgres(url, { max: 1, onnotice() {} });
    const name = `passkey_upgrade_${randomUUID().replaceAll("-", "")}_test`;
    const previous = await mkdtemp(join(tmpdir(), "towbar-passkey-upgrade-"));
    let client;
    try {
      await cp(folder, previous, { recursive: true });
      const journal = JSON.parse(
        await readFile(join(previous, "meta/_journal.json"), "utf8"),
      );
      journal.entries = journal.entries.filter((entry) => entry.idx < 21);
      await writeFile(
        join(previous, "meta/_journal.json"),
        JSON.stringify(journal),
      );
      await admin.unsafe(`CREATE DATABASE "${name}"`);
      const dbUrl = new URL(url);
      dbUrl.pathname = `/${name}`;
      client = postgres(dbUrl.href, { max: 1, onnotice() {} });
      await migrate(drizzle(client), { migrationsFolder: previous });
      const passkeyId = randomUUID(),
        totpId = randomUUID(),
        passwordId = randomUUID();
      for (const id of [passkeyId, totpId, passwordId]) {
        await client`insert into towbar_users (id,email,display_name,two_factor_enabled) values (${id},${id + "@test.local"},'Upgrade',${id === totpId})`;
        await client`insert into towbar_sessions (id,user_id,token,expires_at) values (${randomUUID()},${id},${randomUUID()},now() + interval '1 day')`;
      }
      await client`insert into towbar_auth_two_factors (user_id,secret,backup_codes) values (${totpId},'retired-secret','retired-codes')`;
      await client`insert into towbar_auth_passkeys (user_id,public_key,credential_id,counter,device_type,backed_up) values (${passkeyId},'public-key','credential-id',5,'singleDevice',false)`;
      const before = await client`select * from towbar_auth_passkeys`;
      await migrate(drizzle(client), { migrationsFolder: folder });
      assert.deepEqual(
        await client`select * from towbar_auth_passkeys`,
        before,
      );
      assert.equal(
        (await client`select to_regclass('towbar_auth_two_factors') as name`)[0]
          .name,
        null,
      );
      assert.equal(
        (await client`select * from towbar_auth_recovery_codes`).length,
        0,
      );
      assert.deepEqual(
        (await client`select user_id from towbar_sessions`).map(
          (row) => row.user_id,
        ),
        [passwordId],
      );
      const flags =
        await client`select id,two_factor_enabled from towbar_users`;
      assert.equal(
        flags.find((row) => row.id === passkeyId).two_factor_enabled,
        true,
      );
      assert.equal(
        flags.find((row) => row.id === totpId).two_factor_enabled,
        false,
      );
      await client`insert into towbar_sessions (id,user_id,token,expires_at) values (${randomUUID()},${passkeyId},${randomUUID()},now() + interval '1 day')`;
      await migrate(drizzle(client), { migrationsFolder: folder });
      assert.equal((await client`select * from towbar_sessions`).length, 2);
    } finally {
      if (client) await client.end();
      await admin.unsafe(`DROP DATABASE IF EXISTS "${name}"`);
      await admin.end();
      await rm(previous, { recursive: true, force: true });
    }
  },
);
