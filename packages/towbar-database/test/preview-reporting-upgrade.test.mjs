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
  "preview reporting recovery migration preserves failed deliveries and applies twice safely",
  { skip: !url },
  async () => {
    assert(new URL(url).pathname.endsWith("_test"));
    const admin = postgres(url, { max: 1, onnotice() {} });
    const name = `preview_reporting_${randomUUID().replaceAll("-", "")}_test`;
    const previous = await mkdtemp(join(tmpdir(), "towbar-preview-upgrade-"));
    let client;
    try {
      await cp(folder, previous, { recursive: true });
      const journal = JSON.parse(
        await readFile(join(previous, "meta/_journal.json"), "utf8"),
      );
      journal.entries = journal.entries.filter((entry) => entry.idx < 20);
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
        sourceId = randomUUID();
      await client`insert into towbar_workspaces (id,slug,name) values (${workspaceId},${workspaceId},'Reporting upgrade')`;
      const connectionId = randomUUID();
      await client`insert into towbar_integration_installations (id,workspace_id,provider,external_id,principal_name,principal_type) values (${connectionId},${workspaceId},'github',${connectionId},'fixture','Organization')`;
      await client`insert into towbar_sources (id,workspace_id,integration_installation_id,repository_owner,repository_name) values (${sourceId},${workspaceId},${connectionId},'fixture','reporting')`;
      await client`insert into towbar_preview_pull_request_reports (workspace_id,source_id,pull_request_number,branch,latest_commit_sha,comment_delivery_status,comment_delivery_error,deployment_delivery_status,deployment_delivery_error) values (${workspaceId},${sourceId},7,'feature','abc','failed','offline','failed','rate limited')`;
      const [before] =
        await client`select * from towbar_preview_pull_request_reports where source_id=${sourceId}`;
      await migrate(drizzle(client), { migrationsFolder: folder });
      await migrate(drizzle(client), { migrationsFolder: folder });
      const [after] =
        await client`select * from towbar_preview_pull_request_reports where source_id=${sourceId}`;
      for (const [key, value] of Object.entries(before))
        assert.deepEqual(after[key], value);
      assert.equal(after.comment_delivery_attempts, 0);
      assert.equal(after.deployment_delivery_attempts, 0);
      assert.equal(after.comment_next_attempt_at, null);
      assert.equal(after.deployment_next_attempt_at, null);
    } finally {
      if (client) await client.end();
      await admin.unsafe(`DROP DATABASE IF EXISTS "${name}"`);
      await admin.end();
      await rm(previous, { recursive: true, force: true });
    }
  },
);
