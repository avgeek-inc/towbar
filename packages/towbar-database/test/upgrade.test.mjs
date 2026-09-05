import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.TOWBAR_TEST_DATABASE_URL;
test(
  "workspace migration preserves existing cleanup history",
  { skip: !url },
  async () => {
    assert(
      new URL(url).pathname.endsWith("_test"),
      "Use a dedicated test database ending in _test",
    );
    const admin = postgres(url, { max: 1, onnotice() {} });
    const databaseName = `towbar_upgrade_${randomUUID().replaceAll("-", "")}_test`;
    const folder = await mkdtemp(path.join(tmpdir(), "towbar-upgrade-"));
    let client;
    try {
      await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
      const databaseUrl = new URL(url);
      databaseUrl.pathname = `/${databaseName}`;
      client = postgres(databaseUrl.toString(), { max: 1, onnotice() {} });
      const migrationsFolder = fileURLToPath(
        new URL("../drizzle", import.meta.url),
      );
      await cp(migrationsFolder, folder, { recursive: true });
      const journalPath = path.join(folder, "meta/_journal.json");
      const journal = JSON.parse(await readFile(journalPath, "utf8"));
      journal.entries = journal.entries.filter((entry) => entry.idx < 37);
      await writeFile(journalPath, JSON.stringify(journal));
      await migrate(drizzle(client), { migrationsFolder: folder });

      const [workspace] =
        await client`insert into towbar_workspaces (slug, name) values ('upgrade', 'Upgrade test') returning id`;
      const [installation] =
        await client`insert into towbar_github_installations (workspace_id, installation_id, account_login, account_type) values (${workspace.id}, '1', 'example', 'Organization') returning id`;
      const [source] =
        await client`insert into towbar_sources (workspace_id, github_installation_id, repository_owner, repository_name, branch) values (${workspace.id}, ${installation.id}, 'example', 'app', 'main') returning id`;
      const [server] =
        await client`insert into towbar_servers (workspace_id, source_id, canonical_ip, config, config_digest, source_revision) values (${workspace.id}, ${source.id}, '192.0.2.10', '{}', 'fixture', 'fixture') returning id`;
      const [operation] =
        await client`insert into towbar_resource_operations (workspace_id, source_id, server_id, idempotency_key, temporal_workflow_id, type, state, request, server_snapshot) values (${workspace.id}, ${source.id}, ${server.id}, 'cleanup-test', 'cleanup-test', 'cleanup_orphans', 'succeeded', '{"type":"cleanup_orphans","items":[]}', '{}') returning id`;

      await migrate(drizzle(client), { migrationsFolder });
      const [upgraded] =
        await client`select source_id, server_id, type, state from towbar_resource_operations where id = ${operation.id}`;
      assert.deepEqual(upgraded, {
        source_id: null,
        server_id: server.id,
        type: "cleanup_orphans",
        state: "succeeded",
      });
      await assert.rejects(
        client`update towbar_resource_operations set source_id = ${source.id} where id = ${operation.id}`,
        { code: "23514" },
      );
    } finally {
      await client?.end();
      await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}"`);
      await admin.end();
      await rm(folder, { recursive: true, force: true });
    }
  },
);
