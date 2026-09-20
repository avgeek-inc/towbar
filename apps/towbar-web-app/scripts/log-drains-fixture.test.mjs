import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createFixtureApiServer } from "./fixture-api.ts";

async function fixture(role, run, options = {}) {
  const server = createFixtureApiServer({ role, ...options });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const endpoint = `http://127.0.0.1:${server.address().port}/v1/core/log-drains`;
  const request = (path = "", method = "GET") =>
    fetch(`${endpoint}${path}`, { method });
  try {
    await run(request);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("log forwarding exposes only environment-configured public state", async () => {
  await fixture("admin", async (request) => {
    const response = await request();
    assert.equal(response.status, 200);
    const state = await response.json();
    assert(state.configurations.length > 0);
    assert(
      state.configurations.every(
        (configuration) =>
          configuration.source === "environment" &&
          configuration.state === "enabled",
      ),
    );
    assert.equal(JSON.stringify(state).includes("apiKey"), false);
    assert.equal(JSON.stringify(state).includes("headers"), false);
    assert.equal((await request("/otlp", "PUT")).status, 404);
    assert.equal((await request("/otlp/reveal", "POST")).status, 404);
    assert.equal((await request("/otlp/tests", "POST")).status, 404);
  });
});

for (const role of ["member", "viewer"])
  test(`${role} cannot inspect team log forwarding state`, async () => {
    await fixture(role, async (request) => {
      assert.equal((await request()).status, 403);
    });
  });

for (const outcome of ["auth_failure", "rate_limited"])
  test(`fixture exposes persisted ${outcome} health without a credential mutation`, async () => {
    await fixture(
      "admin",
      async (request) => {
        const state = await (await request()).json();
        assert(
          state.configurations.every(
            (configuration) => configuration.health[0]?.status === outcome,
          ),
        );
      },
      { logDrainTestOutcome: outcome },
    );
  });
