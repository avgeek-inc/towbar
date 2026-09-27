import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createFixtureApiServer, fixtureIds } from "./fixture-api.ts";

test("traffic alert fixture exposes only enabled collection and validates rule creation", async () => {
  const server = createFixtureApiServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const request = (path, options) =>
    fetch(`http://127.0.0.1:${server.address().port}/v1/core/${path}`, options);
  try {
    for (const [appId, expected] of [
      [
        "31111111-1111-4111-8111-111111111111",
        { httpRequests: true, pageviews: true },
      ],
      [fixtureIds.app, { httpRequests: true, pageviews: false }],
      [
        "31111111-1111-4111-8111-333333333333",
        { httpRequests: false, pageviews: false },
      ],
    ]) {
      const { app } = await (await request(`apps/${appId}`)).json();
      const path = `servers/${app.serverId}/scout-alerts`;
      const { workloads } = await (await request(path)).json();
      assert.deepEqual(
        workloads.find((w) => w.id === appId).analytics,
        expected,
      );
      for (const metric of ["httpRequests", "pageviews"]) {
        const response = await request(`${path}/rules`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: metric,
            deployableId: appId,
            condition: {
              metric,
              operator: "below",
              threshold: 0,
              windowSeconds: 600,
            },
          }),
        });
        assert.equal(response.status, expected[metric] ? 201 : 400);
        if (response.ok)
          assert.equal(
            (await response.json()).rule.condition.windowSeconds,
            600,
          );
      }
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
