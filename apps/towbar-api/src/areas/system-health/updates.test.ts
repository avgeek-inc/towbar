import assert from "node:assert/strict";
import test from "node:test";

import { checkTowbarUpdates, compareStableVersions } from "./updates.js";

const release = (tag_name: string) =>
  new Response(JSON.stringify({ tag_name, draft: false, prerelease: false }), {
    status: 200,
  });

void test("version comparison uses numeric components", () => {
  assert.equal(compareStableVersions("2.9.0", "v2.10.0"), -1);
  assert.equal(compareStableVersions("v2.10.0", "2.10.0"), 0);
  assert.equal(compareStableVersions("2.11.0", "v2.10.9"), 1);
  assert.equal(compareStableVersions("2.10.0-dev", "v2.10.0"), null);
});

void test("the latest stable release is available when it is newer", async () => {
  const updates = await checkTowbarUpdates("2.0.14", () =>
    Promise.resolve(release("v2.0.15")),
  );
  assert.deepEqual(updates, {
    installedVersion: "2.0.14",
    latestVersion: "2.0.15",
    releaseUrl: "https://github.com/avgeek-inc/towbar/releases/tag/v2.0.15",
    status: "available",
  });
});

void test("an unreachable or invalid release does not report an update", async () => {
  for (const fetcher of [
    () => Promise.resolve(new Response(null, { status: 503 })),
    () => Promise.resolve(release("v2.0.15-rc.1")),
    () => Promise.reject(new Error("offline")),
  ]) {
    const updates = await checkTowbarUpdates("2.0.14", fetcher);
    assert.equal(updates.status, "unavailable");
    assert.equal(updates.latestVersion, null);
  }
});
