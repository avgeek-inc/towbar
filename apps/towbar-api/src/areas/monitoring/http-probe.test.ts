import assert from "node:assert/strict";
import test from "node:test";
import { scoutHttpCheckSchema } from "@workspace/towbar-core";
import {
  type ProbeTransport,
  isPublicProbeAddress,
  probePublicHttp,
} from "./http-probe.js";

const check = scoutHttpCheckSchema.parse({
  url: "https://service.example/health",
});

void test("HTTP probes allow only public unicast network destinations", () => {
  for (const value of [
    "127.0.0.1",
    "0.0.0.0",
    "10.0.0.1",
    "100.100.100.200",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "192.0.2.1",
    "198.18.0.1",
    "224.1.1.1",
    "255.255.255.255",
    "::",
    "::1",
    "0:0:0:0:0:0:0:1",
    "::ffff:7f00:1",
    "::ffff:127.0.0.1",
    "64:ff9b::7f00:1",
    "2001:db8::1",
    "2002:7f00:1::",
    "fc00::1",
    "fe80::1",
    "ff00::1",
    "3fff::1",
    "not-an-address",
  ])
    assert.equal(isPublicProbeAddress(value), false, value);
  for (const value of [
    "1.1.1.1",
    "8.8.8.8",
    "2606:4700:4700::1111",
    "2001:4860:4860::8888",
  ])
    assert.equal(isPublicProbeAddress(value), true, value);
});

void test("HTTP configuration rejects credentials, protocols, ports and invalid ranges", () => {
  for (const url of [
    "garbage",
    "ftp://example.com",
    "https://user:pass@example.com",
    "https://example.com:8080",
    "https://example.com/#fragment",
  ])
    assert.equal(scoutHttpCheckSchema.safeParse({ url }).success, false, url);
  assert.equal(
    scoutHttpCheckSchema.safeParse({
      ...check,
      expectedStatusMin: 500,
      expectedStatusMax: 200,
    }).success,
    false,
  );
});

void test("mixed DNS and private redirect targets are blocked before connection", async () => {
  let requests = 0;
  const mixed: ProbeTransport = {
    resolve: () => Promise.resolve(["1.1.1.1", "127.0.0.1"]),
    request: () => {
      requests++;
      return Promise.resolve({ status: 200 });
    },
  };
  assert.equal((await probePublicHttp(check, mixed)).state, "blocked");
  assert.equal(requests, 0);
  const redirect: ProbeTransport = {
    resolve: () => Promise.resolve(["1.1.1.1"]),
    request: (_url, address) => {
      assert.equal(address, "1.1.1.1");
      requests++;
      return Promise.resolve({
        status: 302,
        location: "http://169.254.169.254/latest/meta-data",
      });
    },
  };
  assert.equal(
    (await probePublicHttp({ ...check, maxRedirects: 3 }, redirect)).state,
    "blocked",
  );
  assert.equal(requests, 1);
});

void test("each redirect resolves and pins its own address; expected status is configurable", async () => {
  const connected: string[] = [];
  const transport: ProbeTransport = {
    resolve: (host) =>
      Promise.resolve(host === "service.example" ? ["1.1.1.1"] : ["8.8.8.8"]),
    request: (_url, address) => {
      connected.push(address);
      return Promise.resolve(
        connected.length === 1
          ? { status: 307, location: "https://other.example/ready" }
          : { status: 204 },
      );
    },
  };
  assert.equal(
    (await probePublicHttp({ ...check, maxRedirects: 2 }, transport)).state,
    "healthy",
  );
  assert.deepEqual(connected, ["1.1.1.1", "8.8.8.8"]);
  const unavailable: ProbeTransport = {
    resolve: () => Promise.resolve(["1.1.1.1"]),
    request: () => Promise.resolve({ status: 503 }),
  };
  assert.equal((await probePublicHttp(check, unavailable)).state, "failed");
  assert.equal(
    (
      await probePublicHttp(
        { ...check, expectedStatusMin: 503, expectedStatusMax: 503 },
        unavailable,
      )
    ).state,
    "healthy",
  );
});

void test("redirect limits and a single total deadline bound every probe", async () => {
  let requests = 0;
  const redirect: ProbeTransport = {
    resolve: () => Promise.resolve(["1.1.1.1"]),
    request: () => {
      requests++;
      return Promise.resolve({ status: 301, location: "/again" });
    },
  };
  assert.equal(
    (await probePublicHttp({ ...check, maxRedirects: 2 }, redirect)).reason,
    "Too many redirects",
  );
  assert.equal(requests, 3);
  const hanging: ProbeTransport = {
    resolve: () => Promise.resolve(["1.1.1.1"]),
    request: (_url, _address, _method, signal) =>
      new Promise((_resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Test did not abort")),
          2000,
        );
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(new Error("Request aborted"));
          },
          { once: true },
        );
      }),
  };
  const started = Date.now();
  assert.equal(
    (await probePublicHttp({ ...check, timeoutSeconds: 1 }, hanging)).reason,
    "Request timed out",
  );
  assert.ok(Date.now() - started < 1800);
});
