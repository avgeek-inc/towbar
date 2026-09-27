import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
const template = readFileSync(
  new URL("../../towbar-monitoring-agent/browser.go", import.meta.url),
  "utf8",
).split("`")[1];
function harness(identity, privacy = false) {
  const events = [],
    listeners = {},
    storage = new Map();
  const context = {
    window: {},
    navigator: { doNotTrack: privacy ? "1" : "0" },
    document: {
      referrer: "https://ref.example/path?token=x",
      visibilityState: "visible",
    },
    location: { pathname: "/start", origin: "https://example.com" },
    history: { pushState() {}, replaceState() {} },
    crypto: webcrypto,
    URL,
    Uint8Array,
    Date,
    Array,
    JSON,
    localStorage: {
      getItem: (k) => storage.get(k),
      setItem: (k, v) => storage.set(k, v),
    },
    fetch: (_url, init) => {
      events.push(JSON.parse(init.body));
      assert.equal(init.credentials, "omit");
      return Promise.resolve({});
    },
    addEventListener: (name, fn) => (listeners[name] = fn),
  };
  vm.createContext(context);
  const run = () =>
    vm.runInContext(template.replace("%t", String(identity)), context);
  run();
  return { context, events, listeners, storage, run };
}
test("anonymous script counts initial/SPA pageviews once and never creates identity", () => {
  const h = harness(false);
  h.run();
  assert.equal(h.events.length, 1);
  assert.equal(h.storage.size, 0);
  assert.equal(h.events[0].visitor, "");
  h.context.history.replaceState();
  assert.equal(h.events.length, 1);
  h.context.location.pathname = "/next";
  h.context.history.pushState();
  assert.equal(h.events.length, 2);
  h.listeners.popstate();
  assert.equal(h.events.length, 2);
  h.listeners.pageshow({ persisted: true });
  assert.equal(h.events.length, 3);
  assert.equal(h.events[2].referrer, "https://example.com");
});
test("manifest identity creates expiring IDs and reuses IDs within a session", () => {
  const h = harness(true);
  assert.match(h.events[0].visitor, /^[a-f0-9]{32}$/);
  assert.match(h.events[0].session, /^[a-f0-9]{32}$/);
  h.context.location.pathname = "/next";
  h.context.history.pushState();
  assert.equal(h.events[0].visitor, h.events[1].visitor);
  assert.equal(h.events[0].session, h.events[1].session);
  const expired = JSON.parse(h.storage.get("towbar_session"));
  expired.expires = 0;
  h.storage.set("towbar_session", JSON.stringify(expired));
  h.context.location.pathname = "/again";
  h.context.history.pushState();
  assert.notEqual(h.events[1].session, h.events[2].session);
});
test("privacy signals suppress collection and identity storage", () => {
  const h = harness(true, true);
  assert.equal(h.events.length, 0);
  assert.equal(h.storage.size, 0);
});
