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
  "GitHub account migration preserves legacy connections and sources, and keeps other provider constraints",
  { skip: !url },
  async () => {
    assert(new URL(url).pathname.endsWith("_test"));
    const admin = postgres(url, { max: 1, onnotice() {} });
    const name = `github_accounts_upgrade_${randomUUID().replaceAll("-", "")}_test`;
    const previous = await mkdtemp(join(tmpdir(), "towbar-github-upgrade-"));
    let client;
    try {
      await cp(folder, previous, { recursive: true });
      const journal = JSON.parse(
        await readFile(join(previous, "meta/_journal.json"), "utf8"),
      );
      journal.entries = journal.entries.filter(
        (entry) => entry.tag !== "0019_github_accounts",
      );
      await writeFile(
        join(previous, "meta/_journal.json"),
        JSON.stringify(journal),
      );
      await admin.unsafe(`CREATE DATABASE "${name}"`);
      const databaseUrl = new URL(url);
      databaseUrl.pathname = `/${name}`;
      client = postgres(databaseUrl.href, { max: 1, onnotice() {} });
      await migrate(drizzle(client), { migrationsFolder: previous });
      const workspaceId = randomUUID(),
        connectionId = randomUUID(),
        sourceId = randomUUID();
      await client`insert into towbar_workspaces (id, slug, name) values (${workspaceId}, ${workspaceId}, 'Legacy GitHub')`;
      await client`insert into towbar_integration_installations (id, workspace_id, provider, external_id, principal_name, principal_type) values (${connectionId}, ${workspaceId}, 'github', '123456', 'avgeek-inc', 'Organization')`;
      await client`insert into towbar_sources (id, workspace_id, integration_installation_id, repository_owner, repository_name) values (${sourceId}, ${workspaceId}, ${connectionId}, 'avgeek-inc', 'towbar')`;
      const sourceBefore =
        await client`select * from towbar_sources where id=${sourceId}`;
      await assert.rejects(
        client`insert into towbar_integration_installations (workspace_id, provider, external_id, principal_name, principal_type) values (${workspaceId}, 'github', '654321', 'avgeek-oss', 'Organization')`,
        { code: "23505" },
      );
      await migrate(drizzle(client), { migrationsFolder: folder });
      await migrate(drizzle(client), { migrationsFolder: folder });
      assert.deepEqual(
        await client`select * from towbar_sources where id=${sourceId}`,
        sourceBefore,
      );
      const [connection] =
        await client`select * from towbar_integration_installations where id=${connectionId}`;
      assert.equal(connection.principal_id, null);
      assert.equal(connection.external_id, "123456");
      await client`update towbar_integration_installations set principal_id='1001', principal_name='avgeek-labs' where id=${connectionId}`;
      await client`insert into towbar_integration_installations (workspace_id, provider, external_id, principal_id, principal_name, principal_type) values (${workspaceId}, 'github', '654321', '1002', 'avgeek-oss', 'Organization')`;
      await assert.rejects(
        client`insert into towbar_integration_installations (workspace_id, provider, external_id, principal_id, principal_name, principal_type) values (${workspaceId}, 'github', '654322', '1002', 'avgeek-oss', 'Organization')`,
        { code: "23505" },
      );
      await client`insert into towbar_integration_installations (workspace_id, provider, external_id, principal_name, principal_type) values (${workspaceId}, 'gitlab', 'other-1', 'other', 'Organization')`;
      await assert.rejects(
        client`insert into towbar_integration_installations (workspace_id, provider, external_id, principal_name, principal_type) values (${workspaceId}, 'gitlab', 'other-2', 'other2', 'Organization')`,
        { code: "23505" },
      );
    } finally {
      if (client) await client.end();
      await admin.unsafe(`DROP DATABASE IF EXISTS "${name}"`);
      await admin.end();
      await rm(previous, { recursive: true, force: true });
    }
  },
);
