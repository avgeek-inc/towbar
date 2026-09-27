import assert from "node:assert/strict";
import process from "node:process";
import { once } from "node:events";
import { createServer, request as httpRequest } from "node:http";
import { Readable } from "node:stream";
import { connect } from "node:net";
import test from "node:test";
import { createDemoServer } from "./public-demo/gateway.mjs";

const origin = "https://try.towbar.dev";
const serverId = "21111111-1111-4111-8111-111111111111";
const appId = "31111111-1111-4111-8111-222222222222";
const serverPath = `/v1/core/servers/${serverId}`;
const workerUrl = new URL("../dist/public-demo/worker.mjs", import.meta.url);

async function setup(t, options = {}) {
  const server = createDemoServer({ origin, workerUrl, ...options });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.stopDemo());
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, { cookie, body, headers, method = "GET" } = {}) =>
    new Promise((resolve, reject) => {
      const request = httpRequest(
        `${base}${path}`,
        {
          method,
          headers: {
            host: "try.towbar.dev",
            ...(method !== "GET" ? { origin } : {}),
            ...(cookie ? { cookie } : {}),
            ...(body !== undefined
              ? { "content-type": "application/json" }
              : {}),
            ...headers,
          },
        },
        (response) =>
          resolve(
            new Response(Readable.toWeb(response), {
              status: response.statusCode,
              headers: Object.fromEntries(
                Object.entries(response.headers).map(([key, value]) => [
                  key,
                  Array.isArray(value) ? value.join(", ") : value,
                ]),
              ),
            }),
          ),
      );
      request.on("error", reject);
      request.end(
        body !== undefined
          ? typeof body === "string"
            ? body
            : JSON.stringify(body)
          : undefined,
      );
    });
  const start = async () => {
    const response = await call("/__demo/start", { method: "POST" });
    assert.equal(response.status, 201, await response.clone().text());
    return response.headers.get("set-cookie").split(";")[0];
  };
  return { server, call, start, base };
}

test("two visitors behind one IP have isolated module state; reset rotates identity and preserves the other visitor", async (t) => {
  const { call, start } = await setup(t);
  const a = await start(),
    b = await start();
  assert.notEqual(a, b);
  const before = await (await call(serverPath, { cookie: b })).json();
  assert.equal(before.server.setupStatus, "ready");
  assert.equal(
    (
      await call(`${serverPath}/name`, {
        cookie: a,
        method: "PATCH",
        body: { name: "Only visitor A" },
      })
    ).status,
    200,
  );
  assert.equal(
    (await (await call(serverPath, { cookie: a })).json()).server.name,
    "Only visitor A",
  );
  assert.deepEqual(
    await (await call(serverPath, { cookie: b })).json(),
    before,
  );
  const reset = await call("/__demo/reset", { cookie: a, method: "POST" });
  assert.equal(reset.status, 201);
  const c = reset.headers.get("set-cookie").split(";")[0];
  assert.notEqual(a, c);
  assert.equal((await call(serverPath, { cookie: a })).status, 401);
  assert.equal(
    (await (await call(serverPath, { cookie: c })).json()).server.name,
    before.server.name,
  );
  assert.equal((await call(serverPath, { cookie: b })).status, 200);
  const user = (await (await call("/v1/core/session", { cookie: c })).json())
    .user;
  assert.equal(user.email, "visitor@example.com");
});

test("cookies are secure, host-only, opaque; supplied IDs cannot create a session; sign-out revokes immediately", async (t) => {
  const { call } = await setup(t);
  const response = await call("/__demo/start", {
    method: "POST",
    cookie: `__Host-towbar-demo=${"a".repeat(64)}`,
  });
  const cookie = response.headers.get("set-cookie");
  assert.match(
    cookie,
    /^__Host-towbar-demo=[a-f0-9]{64}; Path=\/; HttpOnly; SameSite=Strict; Max-Age=600; Secure$/,
  );
  assert(!cookie.includes("a".repeat(64)));
  const identity = cookie.split(";")[0];
  assert.equal(
    (await call("/__demo/start", { method: "POST", cookie: identity })).status,
    200,
  );
  assert.equal(
    (await call(serverPath, { cookie: `${identity}; ${identity}` })).status,
    401,
  );
  const end = await call("/v1/core/session", {
    method: "DELETE",
    cookie: identity,
  });
  assert.equal(end.status, 200);
  assert.match(end.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal((await call(serverPath, { cookie: identity })).status, 401);
  assert.equal(
    (await call(`${serverPath}?session=${identity.split("=")[1]}`)).status,
    401,
  );
});

test("fixed expiry rejects active users, reaps streams, and returns capacity", async (t) => {
  let clock = Date.now();
  const { call, start } = await setup(t, { maxSessions: 1, now: () => clock });
  const cookie = await start();
  const initial = await (await call("/__demo/session", { cookie })).json();
  clock += 9 * 60_000;
  assert.equal((await call(serverPath, { cookie })).status, 200);
  assert.equal(
    (await (await call("/__demo/session", { cookie })).json()).expiresAt,
    initial.expiresAt,
  );
  clock += 60_001;
  assert.equal((await call(serverPath, { cookie })).status, 401);
  await start();
});

test(
  "expiry timer closes an existing event stream without another request",
  { timeout: 5000 },
  async (t) => {
    const { call, start } = await setup(t, { ttlMs: 1200 });
    const cookie = await start();
    const stream = await call(
      "/v1/core/deployments/61111111-1111-4111-8111-111111111111/events",
      { cookie },
    );
    assert.equal(stream.status, 200);
    const reader = stream.body.getReader();
    assert.match(
      new TextDecoder().decode((await reader.read()).value),
      /event: deployment/,
    );
    await assert.rejects(async () => {
      while (!(await reader.read()).done) {
        /* Wait for expiry to close the stream. */
      }
    });
    assert.equal((await call(serverPath, { cookie })).status, 401);
  },
);

test("worker startup failure returns capacity and never issues a cookie", async (t) => {
  const { call } = await setup(t, {
    maxSessions: 1,
    workerUrl: new URL("data:text/javascript,throw new Error('test crash')"),
  });
  for (let i = 0; i < 2; i++) {
    const response = await call("/__demo/start", { method: "POST" });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal((await response.json()).error.code, "DEMO_UNAVAILABLE");
  }
});

test("capacity reservation survives concurrent starts and reset", async (t) => {
  const { call } = await setup(t, { maxSessions: 1 });
  const responses = await Promise.all([
    call("/__demo/start", { method: "POST" }),
    call("/__demo/start", { method: "POST" }),
  ]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [201, 503]);
  const cookie = responses
    .find((r) => r.status === 201)
    .headers.get("set-cookie")
    .split(";")[0];
  assert.equal(
    (await call("/__demo/reset", { cookie, method: "POST" })).status,
    201,
  );
  assert.equal((await call(serverPath, { cookie })).status, 401);
  assert.equal((await call("/__demo/start", { method: "POST" })).status, 503);
});

test("network start limits cannot be bypassed by client forwarding headers or cookie removal", async (t) => {
  const { call, start } = await setup(t, { startsPerNetwork: 1 });
  await start();
  const denied = await call("/__demo/start", {
    method: "POST",
    headers: {
      "x-forwarded-for": "192.0.2.44",
      "x-demo-client-ip": "192.0.2.44",
    },
  });
  assert.equal(denied.status, 429);
  assert.equal(denied.headers.get("retry-after"), "60");
});

test("origins, body limits, denied endpoints, WebSockets, and unreviewed routes fail closed", async (t) => {
  const { call, start, base } = await setup(t);
  const cookie = await start();
  for (const path of [
    "/__demo/start",
    "/__demo/reset",
    "/__demo/session",
    `${serverPath}/name`,
  ]) {
    assert.equal(
      (
        await call(path, {
          cookie,
          method: "POST",
          headers: { origin: "https://attacker.example" },
        })
      ).status,
      403,
    );
    assert.equal(
      (await call(path, { cookie, method: "POST", headers: { origin: "" } }))
        .status,
      403,
    );
  }
  assert.equal(
    (
      await call(serverPath, {
        cookie,
        headers: { origin: "https://attacker.example" },
      })
    ).status,
    403,
  );
  for (const [method, path] of [
    ["POST", "/v1/core/sources/connect"],
    ["POST", "/v1/core/github/actions/installation-url"],
    ["POST", "/v1/core/gitlab/oauth/start"],
    ["POST", "/v1/core/team/invitations"],
    ["POST", "/v1/core/settings/private-keys"],
    ["GET", "/v1/core/settings/private-keys/test/reveal"],
    ["POST", `/v1/core/apps/${appId}/terminal`],
    ["PATCH", `${serverPath}/credentials`],
    ["POST", "/v1/core/notifications/telegram/destinations/test"],
    ["POST", "/v1/public/auth/identity/sign-in/email"],
    ["GET", "/v1/core/new-unreviewed-route"],
    ["POST", "/api/proxy"],
    ["GET", "/_next/image?url=http://169.254.169.254/latest/meta-data"],
  ]) {
    const response = await call(path, {
      cookie,
      method,
      ...(method !== "GET"
        ? {
            body: {
              url: "http://169.254.169.254/",
              privateKey: "DO_NOT_STORE",
            },
          }
        : {}),
    });
    assert.equal(response.status, 403, path);
  }
  assert.equal(
    (await call(`${serverPath}/name`, { cookie, method: "PATCH", body: "{" }))
      .status,
    400,
  );
  assert.equal(
    (
      await call(`${serverPath}/name`, {
        cookie,
        method: "PATCH",
        body: { name: "x".repeat(17_000) },
      })
    ).status,
    413,
  );
  assert.equal((await call("/v1/core/%73ervers", { cookie })).status, 400);
  assert.equal(
    (await call(serverPath, { headers: { host: "evil.example" } })).status,
    421,
  );
  const socket = connect(new URL(base).port, "127.0.0.1");
  await once(socket, "connect");
  socket.write(
    "GET /v1/core/terminal HTTP/1.1\r\nHost: try.towbar.dev\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n",
  );
  const [reply] = await once(socket, "data");
  assert.match(reply.toString(), /403 Forbidden/);
  socket.destroy();
});

test("real fixture deployment is simulated to completion only in its owner's worker", async (t) => {
  const { call, start } = await setup(t);
  const a = await start(),
    b = await start();
  const response = await call(`/v1/core/apps/${appId}/actions/deploy`, {
    cookie: a,
    method: "POST",
  });
  assert.equal(response.status, 202);
  const { deployment } = await response.json();
  assert.equal(
    (await call(`/v1/core/deployments/${deployment.id}`, { cookie: b })).status,
    404,
  );
  await new Promise((resolve) => setTimeout(resolve, 6500));
  const completed = await (
    await call(`/v1/core/deployments/${deployment.id}`, { cookie: a })
  ).json();
  assert.equal(completed.deployment.state, "succeeded");
  const history = await (
    await call(`/v1/core/deployments/${deployment.id}/steps`, { cookie: a })
  ).json();
  assert.deepEqual(
    history.steps.map((step) => step.state),
    ["queued", "building", "starting_candidate", "succeeded"],
  );
  assert.ok(history.steps.every((step) => step.status === "succeeded"));
});

test("UI proxy never forwards caller credentials or accepts writes; all responses forbid caching", async (t) => {
  let observed;
  const web = createServer((request, response) => {
    observed = request.headers;
    response.setHeader("set-cookie", "unsafe=fixture");
    response.setHeader("x-nextjs-stale-time", "300");
    response.setHeader("x-nextjs-prerender", "1");
    response.end("UI");
  });
  web.listen(0, "127.0.0.1");
  await once(web, "listening");
  t.after(() => new Promise((resolve) => web.close(resolve)));
  const { call, start } = await setup(t, { webPort: web.address().port });
  assert.equal((await call("/")).headers.get("location"), "/demo");
  const cookie = await start();
  const response = await call("/", {
    cookie,
    headers: {
      authorization: "Bearer TEST",
      "next-router-segment-prefetch": "/_tree",
      "x-forwarded-host": "evil.example",
    },
  });
  assert.equal(await response.text(), "UI");
  assert.equal(observed.cookie, undefined);
  assert.equal(observed.authorization, undefined);
  assert.equal(observed["next-router-segment-prefetch"], "/_tree");
  assert.equal(response.headers.get("x-nextjs-stale-time"), "300");
  assert.equal(response.headers.get("x-nextjs-prerender"), "1");
  assert.equal(observed["x-forwarded-host"], undefined);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.match(
    response.headers.get("content-security-policy"),
    /connect-src 'self'/,
  );
  assert.equal(
    (await call("/", { cookie, method: "POST", body: {} })).status,
    403,
  );
});

test("24 workers fit the configured capacity and the 25th is rejected", async (t) => {
  const { start, call } = await setup(t, { startsPerNetwork: 30 });
  const started = performance.now();
  const cookies = [];
  for (let i = 0; i < 24; i++) cookies.push(await start());
  assert.equal(new Set(cookies).size, 24);
  assert.equal((await call("/__demo/start", { method: "POST" })).status, 503);
  const residentMiB = Math.ceil(process.memoryUsage().rss / 1024 ** 2);
  t.diagnostic(
    `24 fixture workers: ${residentMiB} MiB process RSS; ${Math.round(performance.now() - started)} ms sequential startup (host-specific, excludes Next/Caddy).`,
  );
});

test("a worker that crashes after startup revokes its cookie and releases capacity", async (t) => {
  const workerUrl = new URL(
    `data:text/javascript,${encodeURIComponent(`
    import { createServer } from 'node:http';
    import { parentPort } from 'node:worker_threads';
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      parentPort.postMessage({port: server.address().port});
      setTimeout(() => process.exit(1), 200);
    });
  `)}`,
  );
  const { call, start } = await setup(t, { workerUrl, maxSessions: 1 });
  const cookie = await start();
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal((await call(serverPath, { cookie })).status, 401);
  await start();
});

test("preferences and pause controls use the current dashboard API contract", async (t) => {
  const { call, start } = await setup(t);
  const cookie = await start();
  const preferences = (
    await (await call("/v1/core/profile/preferences", { cookie })).json()
  ).preferences;
  const response = await call("/v1/core/profile/preferences", {
    cookie,
    method: "PUT",
    body: { ...preferences, timeZone: "Asia/Kolkata" },
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).preferences.timeZone, "Asia/Kolkata");
  const pause = await call(`/v1/core/apps/${appId}/auto-deploy-control`, {
    cookie,
    method: "PATCH",
    body: { paused: true },
  });
  assert.equal(pause.status, 200);
  assert.equal((await pause.json()).autoDeploy.paused, true);
});

test("only the exact proxy peer can supply an address; IPv6 privacy addresses share a start budget", async (t) => {
  const { call } = await setup(t, {
    trustedProxy: "127.0.0.1",
    startsPerNetwork: 1,
  });
  const start = (ip) =>
    call("/__demo/start", {
      method: "POST",
      headers: { "x-demo-client-ip": ip },
    });
  assert.equal((await start("2001:db8:1:2::1")).status, 201);
  assert.equal(
    (await start("2001:0db8:0001:0002:ffff:ffff:ffff:ffff")).status,
    429,
  );
  assert.equal((await start("2001:db8:1:3::1")).status, 201);
  assert.equal((await start("attacker.example")).status, 400);
});

test("open streams consume the per-session request allowance", async (t) => {
  const { call, start } = await setup(t);
  const cookie = await start();
  const path =
    "/v1/core/deployments/61111111-1111-4111-8111-111111111111/events";
  const streams = await Promise.all(
    Array.from({ length: 8 }, () => call(path, { cookie })),
  );
  assert(streams.every((response) => response.status === 200));
  assert.equal((await call(path, { cookie })).status, 429);
  await Promise.all(streams.map((response) => response.body.cancel()));
});
