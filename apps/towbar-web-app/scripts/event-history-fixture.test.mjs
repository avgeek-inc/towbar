import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createFixtureApiServer } from "./fixture-api.ts";
async function fixture(role, run) {
  const server = createFixtureApiServer({ role });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await run((path) =>
      fetch(`http://127.0.0.1:${server.address().port}/v1/core/${path}`),
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
test("fixture audit filters, search, and pagination agree with the table", async () => {
  await fixture("admin", async (request) => {
    const first = await (await request("team/audit-logs")).json();
    assert.equal(first.items.length, 25);
    const second = await (
      await request(`team/audit-logs?${new URLSearchParams(first.nextCursor)}`)
    ).json();
    assert(
      !second.items.some((item) =>
        first.items.some((old) => old.id === item.id),
      ),
    );
    const entry = first.items.find((item) => item.actorUserId);
    const filtered = await (
      await request(
        `team/audit-logs?${new URLSearchParams({ event: entry.slug, userId: entry.actorUserId, search: entry.label })}`,
      )
    ).json();
    assert(filtered.items.length > 0);
    assert(
      filtered.items.every(
        (item) =>
          item.slug === entry.slug && item.actorUserId === entry.actorUserId,
      ),
    );
    assert.equal(
      (await (await request("team/audit-logs?search=never-found-event")).json())
        .items.length,
      0,
    );
    assert.equal((await request("team/audit-logs?limit=1000")).status, 400);
    const filters = await (await request("team/audit-logs/filters")).json();
    assert(filters.events.length > 40);
    assert.equal(filters.users.length, 2);
  });
});
test("fixture deliveries preserve status metadata and paginate", async () => {
  await fixture("admin", async (request) => {
    const all = await (await request("notifications/deliveries")).json();
    assert.equal(all.items.length, 25);
    assert(all.nextCursor);
    const failed = await (
      await request("notifications/deliveries?provider=discord&state=failed")
    ).json();
    assert(failed.items.length > 0);
    assert(
      failed.items.every(
        (item) =>
          item.provider === "discord" &&
          item.state === "failed" &&
          item.errorCode,
      ),
    );
    const categories = await (
      await request(
        "notifications/deliveries?category=backupsAndRestores&limit=100",
      )
    ).json();
    assert(categories.items.length > 0);
    assert.deepEqual(
      [...new Set(categories.items.map((item) => item.category))].sort(),
      ["backups", "restores"],
    );
    const combined = await (
      await request(
        "notifications/deliveries?category=backupsAndRestores&provider=discord&state=failed",
      )
    ).json();
    assert(combined.items.length > 0);
    assert(
      combined.items.every(
        (item) =>
          item.provider === "discord" &&
          item.state === "failed" &&
          ["backups", "restores"].includes(item.category),
      ),
    );
    const tests = await (
      await request("notifications/deliveries?category=test")
    ).json();
    assert.equal(tests.items.length, 1);
    assert.equal(tests.items[0].type, "notification.test");
    assert.equal(
      (await request("notifications/deliveries?category=invalid")).status,
      400,
    );
    assert(!JSON.stringify(all).includes("webhookUrl"));
  });
});
test("members and viewers cannot read team-wide histories", async () => {
  for (const role of ["member", "viewer"])
    await fixture(role, async (request) => {
      for (const path of [
        "team/audit-logs",
        "team/audit-logs/filters",
        "notifications/deliveries",
      ])
        assert.equal((await request(path)).status, 403);
    });
});
