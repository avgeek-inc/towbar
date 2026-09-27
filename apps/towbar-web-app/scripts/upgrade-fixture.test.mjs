import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createFixtureApiServer } from "./fixture-api.ts";

test("upgrade fixture covers confirmation, blockers, reconnect and persisted outcomes", async () => {
  const server = createFixtureApiServer({ upgradeScenario: "ready" });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, body) =>
    fetch(base + path, {
      method: body ? "POST" : "GET",
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(3000),
    });
  try {
    const version = await (await request("/v1/core/version")).json();
    assert(Number.isFinite(Date.parse(version.checkedAt)));
    assert.equal(
      (await (await request("/v1/core/version")).json()).checkedAt,
      version.checkedAt,
    );
    let response = await request("/v1/core/system-health/upgrade");
    assert.equal((await response.json()).supported, true);
    response = await request("/v1/core/system-health/upgrade/plan", {});
    assert.deepEqual((await response.json()).blockers, []);
    const started = await (
      await request("/v1/core/system-health/upgrade/jobs", {})
    ).json();
    assert.equal(started.state, "applying");
    const running = await (
      await request("/v1/core/system-health/upgrade")
    ).json();
    assert.equal(running.job.id, started.id);
    await request("/__fixture/upgrade", { state: "blocked" });
    response = await request("/v1/core/system-health/upgrade/plan", {});
    assert.equal((await response.json()).blockers.length, 2);
    for (const state of ["applying", "failed", "interrupted", "succeeded"]) {
      await request("/__fixture/upgrade", { state });
      response = await request("/v1/core/system-health/upgrade");
      const result = await response.json();
      assert.equal(result.job.state, state);
      if (state === "failed") {
        assert.match(
          result.job.message,
          /checking service health \(exit code 1\)/u,
        );
        assert.doesNotMatch(result.job.message, /sudo|attempt|host log/u);
      }
    }
    const completedVersion = await (await request("/v1/core/version")).json();
    const completedHealth = await (
      await request("/v1/core/system-health")
    ).json();
    assert.equal(completedVersion.status, "current");
    assert.equal(completedHealth.version, completedVersion.installedVersion);
    await request("/__fixture/upgrade", { state: "next-release" });
    const nextVersion = await (await request("/v1/core/version")).json();
    assert.equal(nextVersion.installedVersion, "2.0.17");
    assert.equal(nextVersion.latestVersion, "2.0.18");
    assert.equal(nextVersion.status, "available");
    const previous = await (
      await request("/v1/core/system-health/upgrade")
    ).json();
    assert.equal(previous.job.state, "succeeded");
    assert.equal(previous.job.targetVersion, "v2.0.17");
    const nextPlan = await (
      await request("/v1/core/system-health/upgrade/plan", {})
    ).json();
    assert.equal(nextPlan.currentVersion, "v2.0.17");
    assert.equal(nextPlan.targetVersion, "v2.0.18");
    const nextJob = await (
      await request("/v1/core/system-health/upgrade/jobs", {})
    ).json();
    assert.equal(nextJob.state, "applying");
    assert.equal(nextJob.targetVersion, "v2.0.18");
    assert.equal(nextJob.planId, nextPlan.id);
    await request("/__fixture/upgrade", { state: "reconnecting" });
    assert.equal((await request("/v1/core/system-health/upgrade")).status, 503);
    await request("/__fixture/upgrade", { state: "unsupported" });
    response = await request("/v1/core/system-health/upgrade");
    assert.equal((await response.json()).supported, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
