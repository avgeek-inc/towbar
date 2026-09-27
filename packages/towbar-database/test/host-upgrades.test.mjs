import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import { runTowbarMigrations } from "../dist/migrate.js";

const url = process.env.TOWBAR_TEST_DATABASE_URL;
test(
  "upgrade barrier serializes all admissions and retains interrupted activity blockers",
  { skip: !url },
  async () => {
    assert(new URL(url).pathname.endsWith("_test"));
    const admin = postgres(url, { max: 1 });
    const databaseName = `towbar_upgrade_${randomUUID().replaceAll("-", "")}_test`;
    await admin.unsafe(`create database ${databaseName}`);
    const isolated = new URL(url);
    isolated.pathname = `/${databaseName}`;
    await runTowbarMigrations({
      databaseUrl: isolated.href,
      logger: { info() {}, error() {} },
    });
    const first = postgres(isolated.href, { max: 1 });
    const second = postgres(isolated.href, { max: 1 });
    const lease = randomUUID();
    const job = randomUUID();
    try {
      await first`update towbar_upgrade_admission set job_id = null`;
      await first`create table upgrade_guard_test (state text)`;
      await first.unsafe(
        "create trigger guard before insert or update on upgrade_guard_test for each row execute function towbar_check_upgrade_admission()",
      );
      await first`insert into upgrade_guard_test values ('queued')`;
      // An earlier admission holds the shared row lock until its transaction commits.
      let admitted;
      const atAdmission = new Promise((resolve) => {
        admitted = resolve;
      });
      let release;
      const hold = new Promise((resolve) => {
        release = resolve;
      });
      const admission = first.begin(async (tx) => {
        await tx`insert into towbar_upgrade_leases (id, kind) values (${lease}, 'deployment')`;
        admitted();
        await hold;
      });
      await atAdmission;
      let paused = false;
      const upgrade = second.begin(async (tx) => {
        await tx`update towbar_upgrade_admission set job_id = ${job} where id=1`;
        paused = true;
        return await tx`select * from towbar_upgrade_blockers where count > 0`;
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(paused, false);
      release();
      await admission;
      const blockers = await upgrade;
      assert(
        blockers.some(
          (row) =>
            row.label === "Active or interrupted activities and terminals" &&
            Number(row.count) >= 1,
        ),
      );
      // Manual, webhook, scheduled, preview and rollback deployment inserts share
      // this database trigger, even when a caller bypasses a service helper.
      for (const table of [
        "towbar_deployments",
        "towbar_source_syncs",
        "towbar_resource_operations",
        "towbar_server_checks",
        "towbar_server_preparations",
        "towbar_server_credential_verifications",
        "towbar_image_vulnerability_scans",
        "towbar_preview_environments",
        "towbar_upgrade_leases",
      ]) {
        await assert.rejects(
          first.unsafe(`insert into ${table} default values`),
          { code: "TB001" },
        );
      }
      await assert.rejects(
        first`update towbar_upgrade_leases set kind='retry' where id=${lease}`,
        { code: "TB001" },
      );
      await first`update upgrade_guard_test set state='failed'`;
      await assert.rejects(
        first`update upgrade_guard_test set state='queued'`,
        { code: "TB001" },
      );
      // Completion can release a lease; no clock or process restart clears it.
      await first`delete from towbar_upgrade_leases where id=${lease}`;
      await first`update towbar_upgrade_admission set job_id=null`;
      await first`insert into towbar_upgrade_leases (id, kind) values (${lease}, 'resumed')`;
      assert.equal(
        (await first`select * from towbar_upgrade_leases where id=${lease}`)
          .length,
        1,
      );
    } finally {
      await first`update towbar_upgrade_admission set job_id=null`;
      await first`delete from towbar_upgrade_leases where id=${lease}`;
      await first.end();
      await second.end();
      await admin.unsafe(`drop database ${databaseName}`);
      await admin.end();
    }
  },
);
