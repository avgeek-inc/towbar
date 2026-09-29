import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import {
  createTowbarClient,
  type TowbarUser,
} from "@workspace/towbar-web-client";
import { createSessionRefresh } from "./session-refresh";

const verifiedUser: TowbarUser = {
  capabilities: [],
  id: "admin",
  name: "Admin",
  email: "admin@example.com",
  emailVerified: true,
  mustChangePassword: false,
  passwordSetupRequired: false,
  teamName: "Platform team",
  twoFactorEnabled: false,
  workspaceId: "workspace",
  workspaceRole: "admin",
};

test("API outages keep the verified session and retry until the API recovers", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const responses = [
    new Response("Bad Gateway", { status: 502 }),
    Response.json({}, { status: 503 }),
    new TypeError("Failed to fetch"),
    Response.json({ user: verifiedUser }),
  ];
  let requests = 0;
  const client = createTowbarClient({
    baseUrl: "https://towbar.example.com",
    fetch: async (_url, options) => {
      assert.equal(options?.credentials, "include");
      requests++;
      const response = responses.shift();
      if (response instanceof Error) throw response;
      assert(response);
      return response;
    },
  });
  let user: TowbarUser | null = verifiedUser;
  let unavailable = false;
  let sessionUpdates = 0;
  const session = createSessionRefresh({
    load: () => client.get("/v1/public/auth/state"),
    onUser: (next) => {
      user = next;
      unavailable = false;
      sessionUpdates++;
    },
    onUnavailable: () => {
      unavailable = true;
    },
  });
  t.after(session.stop);
  await session.refresh();
  for (let attempt = 0; attempt < 3; attempt++) {
    assert.equal(user, verifiedUser);
    assert.equal(sessionUpdates, 0);
    assert(unavailable);
    t.mock.timers.tick(5_000);
    await setImmediate();
  }
  assert.equal(requests, 4);
  assert.deepEqual(user, verifiedUser);
  assert.equal(sessionUpdates, 1);
  assert.equal(unavailable, false);
  t.mock.timers.tick(30_000);
  await setImmediate();
  assert.equal(requests, 4);
});

test("an initial outage never invents a session or reports the user as signed out", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let user: TowbarUser | null | undefined;
  let requests = 0;
  const session = createSessionRefresh({
    load: async () => {
      if (++requests === 1) throw new TypeError("Failed to fetch");
      return { user: verifiedUser };
    },
    onUser: (next) => {
      user = next;
    },
    onUnavailable: () => {},
  });
  t.after(session.stop);
  await session.refresh();
  assert.equal(user, undefined);
  t.mock.timers.tick(5_000);
  await setImmediate();
  assert.equal(user, verifiedUser);
});

test("confirmed session expiry clears the user rather than retrying", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const response of [
    Response.json({ user: null }),
    Response.json({ error: { code: "UNAUTHENTICATED" } }, { status: 401 }),
  ]) {
    let user: TowbarUser | null = verifiedUser;
    let requests = 0;
    const client = createTowbarClient({
      baseUrl: "https://towbar.example.com",
      fetch: async () => {
        requests++;
        return response;
      },
    });
    const session = createSessionRefresh({
      load: () => client.get("/v1/public/auth/state"),
      onUser: (next) => {
        user = next;
      },
      onUnavailable: () => assert.fail("Session expiry is conclusive"),
    });
    t.after(session.stop);
    await session.refresh();
    assert.equal(user, null);
    t.mock.timers.tick(30_000);
    await setImmediate();
    assert.equal(requests, 1);
  }
});

test("stopping session refresh cancels retries and ignores late responses", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let requests = 0;
  const session = createSessionRefresh({
    load: async () => {
      requests++;
      throw new TypeError("Failed to fetch");
    },
    onUser: () => assert.fail("Stopped sessions cannot update the page"),
    onUnavailable: () => {},
  });
  await session.refresh();
  session.stop();
  t.mock.timers.tick(30_000);
  await setImmediate();
  await session.refresh();
  assert.equal(requests, 1);

  let resolve!: (value: { user: TowbarUser | null }) => void;
  const pending = createSessionRefresh({
    load: () =>
      new Promise((done) => {
        resolve = done;
      }),
    onUser: () => assert.fail("Late responses cannot update the page"),
    onUnavailable: () => assert.fail("Stopped sessions cannot retry"),
  });
  const refresh = pending.refresh();
  pending.stop();
  resolve({ user: verifiedUser });
  await refresh;
});

test("focus refresh does not overlap requests or leave a retry after recovery", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let requests = 0;
  let resolve!: (value: { user: TowbarUser | null }) => void;
  const session = createSessionRefresh({
    load: async () => {
      if (++requests === 1) throw new TypeError("Failed to fetch");
      return new Promise((done) => {
        resolve = done;
      });
    },
    onUser: () => {},
    onUnavailable: () => {},
  });
  t.after(session.stop);
  await session.refresh();
  const focused = session.refresh();
  await session.refresh();
  t.mock.timers.tick(5_000);
  assert.equal(requests, 2);
  resolve({ user: verifiedUser });
  await focused;
  t.mock.timers.tick(30_000);
  await setImmediate();
  assert.equal(requests, 2);
});
