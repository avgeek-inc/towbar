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
  let now = Date.now(),
    monotonic = 0,
    heartbeat;
  class Clock extends Date {
    constructor(...args) {
      super(...(args.length ? args : [now]));
    }
    static now() {
      return now;
    }
  }
  const context = {
    window: {},
    navigator: { doNotTrack: privacy ? "1" : "0" },
    document: {
      referrer: "https://ref.example/path?token=x",
      visibilityState: "visible",
      addEventListener: (name, fn) => (listeners[name] = fn),
    },
    location: {
      pathname: "/start",
      origin: "https://example.com",
      hostname: "example.com",
    },
    history: { pushState() {}, replaceState() {} },
    crypto: webcrypto,
    URL,
    Uint8Array,
    Date: Clock,
    Array,
    JSON,
    performance: { now: () => monotonic },
    setInterval: (fn) => {
      heartbeat = fn;
    },
    localStorage: {
      getItem: (k) => storage.get(k),
      setItem: (k, v) => storage.set(k, v),
    },
    fetch: (_url, init) => {
      events.push(JSON.parse(init.body));
      assert.equal(init.credentials, "omit");
      assert.equal(init.keepalive, true);
      return Promise.resolve({});
    },
    addEventListener: (name, fn) => (listeners[name] = fn),
  };
  vm.createContext(context);
  const run = () =>
    vm.runInContext(template.replace("%t", String(identity)), context);
  run();
  return {
    context,
    events,
    listeners,
    storage,
    run,
    advance(ms) {
      now += ms;
      monotonic += ms;
    },
    heartbeat: () => heartbeat(),
    views: () => events.filter((e) => e.kind === "pageview"),
    times: () => events.filter((e) => e.kind === "engagement"),
  };
}
test("anonymous script counts initial/SPA pageviews once without persistent identity", () => {
  const h = harness(false);
  h.run();
  assert.equal(h.views().length, 1);
  assert.equal(h.storage.size, 0);
  assert.equal(h.views()[0].visitor, "");
  h.context.history.replaceState();
  assert.equal(h.views().length, 1);
  h.context.location.pathname = "/next";
  h.context.history.pushState();
  assert.equal(h.views().length, 2);
  h.listeners.popstate();
  assert.equal(h.views().length, 2);
  h.listeners.pageshow({ persisted: true });
  assert.equal(h.views().length, 3);
  assert.equal(h.views()[2].referrer, "https://example.com");
  assert.notEqual(h.views()[0].pageId, h.views()[1].pageId);
});
test("manifest identity creates expiring IDs and reuses IDs within a session", () => {
  const h = harness(true);
  assert.match(h.views()[0].visitor, /^[a-f0-9]{32}$/);
  assert.match(h.views()[0].session, /^[a-f0-9]{32}$/);
  h.context.location.pathname = "/next";
  h.context.history.pushState();
  assert.equal(h.views()[0].visitor, h.views()[1].visitor);
  assert.equal(h.views()[0].session, h.views()[1].session);
  const expired = JSON.parse(h.storage.get("towbar_session"));
  expired.expires = 0;
  h.storage.set("towbar_session", JSON.stringify(expired));
  h.context.location.pathname = "/again";
  h.context.history.pushState();
  assert.notEqual(h.views()[1].session, h.views()[2].session);
});
test("visible time is cumulative, excludes hidden time, and flushes once on navigation", () => {
  const h = harness(false);
  h.advance(15000);
  h.heartbeat();
  assert.equal(h.times()[0].visibleMs, 15000);
  h.advance(5000);
  h.context.document.visibilityState = "hidden";
  h.listeners.visibilitychange();
  h.listeners.pagehide();
  assert.equal(h.times().length, 2);
  assert.equal(h.times()[1].visibleMs, 20000);
  h.advance(600000);
  h.context.document.visibilityState = "visible";
  h.listeners.visibilitychange();
  h.advance(10000);
  h.context.location.pathname = "/next";
  h.context.history.pushState();
  assert.equal(h.times()[2].visibleMs, 30000);
  assert.equal(h.times()[2].path, "/start");
  assert.equal(h.times()[2].pageId, h.views()[0].pageId);
  h.advance(5000);
  h.heartbeat();
  assert.equal(h.times()[3].visibleMs, 5000);
  assert.equal(h.times()[3].path, "/next");
});
test("a return after inactivity starts a fresh session and hidden pages do not collect", () => {
  const h = harness(true);
  h.advance(5000);
  h.context.document.visibilityState = "hidden";
  h.listeners.visibilitychange();
  h.advance(1800001);
  h.heartbeat();
  assert.equal(h.views().length, 1);
  h.context.document.visibilityState = "visible";
  h.listeners.visibilitychange();
  assert.equal(h.views().length, 2);
  assert.notEqual(h.views()[0].session, h.views()[1].session);
});
test("outbound clicks record only website origins and do not change pageview counts", () => {
  const h = harness(false);
  const click = (href, extra = {}) =>
    h.listeners.click({
      type: "click",
      button: 0,
      target: { closest: () => ({ href }) },
      ...extra,
    });
  click("https://user:secret@other.example/path?token=secret#part");
  assert.equal(h.events.at(-1).destination, "https://other.example");
  assert.equal(h.events.at(-1).kind, "outbound");
  assert.equal(h.views().length, 1);
  const count = h.events.length;
  click("https://example.com/next");
  click("mailto:hi@example.com");
  click("https://other.example/", { defaultPrevented: true });
  assert.equal(h.events.length, count);
});
test("privacy signals suppress every event and identity storage", () => {
  const h = harness(true, true);
  h.advance(15000);
  h.heartbeat();
  h.listeners.pagehide();
  assert.equal(h.events.length, 0);
  assert.equal(h.storage.size, 0);
  const active = harness(false);
  active.context.navigator.globalPrivacyControl = true;
  active.advance(15000);
  active.heartbeat();
  active.listeners.pagehide();
  assert.equal(active.events.length, 1);
  active.context.navigator.globalPrivacyControl = false;
  active.advance(30000);
  active.context.document.visibilityState = "visible";
  active.listeners.visibilitychange();
  active.advance(1000);
  active.heartbeat();
  assert.equal(
    active.times().at(-1).visibleMs,
    1000,
    "opted-out time is discarded",
  );
});
