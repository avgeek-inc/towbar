import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeDeploymentManifest,
  normalizeServerConfiguration,
} from "@workspace/towbar-core";
import {
  cleanupCloudflareDnsTransition,
  reconcileCloudflareDns,
  reconcileCloudflareForDeployment,
} from "./cloudflare.js";
import { type DnsRecord, dnsFixture } from "./cloudflare-dns-test-helper.js";

const owned: DnsRecord = {
  id: "owned",
  name: "api.example.com",
  type: "A",
  content: "192.0.2.20",
  comment: "Managed by Towbar: stack",
  proxied: false,
  ttl: 300,
};
const input = {
  apiToken: "test-token",
  appId: "stack",
  domains: ["api.example.com"],
  serverIp: "192.0.2.10",
};

void test("mixed Compose routes reconcile every DNS hostname and skip direct/Tunnel routes", async (t) => {
  const fixture = dnsFixture();
  t.mock.method(globalThis, "fetch", fixture.fetcher);
  const app = normalizeDeploymentManifest({
    version: 2,
    compose: [
      {
        id: "stack",
        name: "Stack",
        server: "192.0.2.10",
        file: "compose.yml",
        services: {
          api: {
            port: 3000,
            domains: ["api.example.com", "ingest.example.com"],
            tls: { mode: "cloudflare-dns" },
          },
          console: {
            port: 8080,
            domains: ["console.example.com"],
            ingress: { type: "proxy" },
            tls: { mode: "cloudflare-dns" },
          },
          direct: {
            port: 80,
            domains: ["direct.example.com"],
            tls: { mode: "direct" },
          },
          tunnel: {
            port: 80,
            domains: ["tunnel.example.com"],
            ingress: { type: "cloudflare-tunnel", integration: "cloudflare" },
          },
        },
      },
    ],
  }).compose![0]!;
  const transition = await reconcileCloudflareForDeployment({
    app,
    credentials: { apiToken: "test-token" },
    server: normalizeServerConfiguration({
      ip: "192.0.2.10",
      ssh: { username: "ubuntu" },
    }),
  });
  assert.deepEqual(
    fixture.mutations.map(({ name }) => name),
    ["api.example.com", "ingest.example.com", "console.example.com"],
  );
  assert(
    [...fixture.records.values()].every(
      ({ comment, proxied }) =>
        comment === "Managed by Towbar: stack" && proxied,
    ),
  );
  await transition!.rollback();
  assert.equal(fixture.records.size, 0);
});

void test("DNS rollback restores an owned record and removes a newly created sibling", async () => {
  const fixture = dnsFixture([owned]);
  const transition = await reconcileCloudflareDns({
    ...input,
    domains: ["api.example.com", "new.example.com"],
    fetcher: fixture.fetcher,
  });
  await transition.rollback();
  assert.deepEqual([...fixture.records.values()], [owned]);
});

void test("a later collision rolls back earlier writes without touching unrelated records", async () => {
  const unrelated = {
    ...owned,
    id: "foreign",
    name: "foreign.example.com",
    comment: "Managed by Towbar: other",
  };
  const fixture = dnsFixture([owned, unrelated]);
  await assert.rejects(
    reconcileCloudflareDns({
      ...input,
      domains: [owned.name, "new.example.com", unrelated.name],
      fetcher: fixture.fetcher,
    }),
    /owned by another/,
  );
  assert.deepEqual([...fixture.records.values()], [owned, unrelated]);
});

void test("rollback restores same-target adoption and preserves later external edits", async () => {
  const manual = {
    ...owned,
    content: input.serverIp,
    comment: "Operator note",
  };
  const fixture = dnsFixture([manual]);
  const transition = await reconcileCloudflareDns({
    ...input,
    allowUnmanagedAdoption: true,
    fetcher: fixture.fetcher,
  });
  await transition.rollback();
  assert.deepEqual(fixture.records.get(owned.id), manual);
  const changed = await reconcileCloudflareDns({
    ...input,
    allowUnmanagedAdoption: true,
    fetcher: fixture.fetcher,
  });
  fixture.records.get(owned.id)!.content = "192.0.2.99";
  await assert.rejects(changed.rollback(), /operator attention/);
  assert.equal(fixture.records.get(owned.id)!.content, "192.0.2.99");
});

void test("uncertain DNS writes fail with a visible rollback warning", async () => {
  const fixture = dnsFixture();
  const fetcher: typeof fetch = async (url, init) => {
    const response = await fixture.fetcher(url, init);
    if (init?.method === "POST") throw new Error("Lost provider response");
    return response;
  };
  await assert.rejects(
    reconcileCloudflareDns({ ...input, fetcher }),
    /rollback needs operator attention/,
  );
  assert.equal(fixture.records.size, 1);
  assert.equal(
    fixture.mutations.some(({ method }) => method === "DELETE"),
    false,
  );
});

void test("cleanup deletes only obsolete owned address records and protects current routes", async () => {
  const live = { ...owned, id: "live", name: "live.example.com" };
  const foreign = { ...owned, id: "foreign", comment: "Operator note" };
  const tunnel = {
    ...owned,
    id: "tunnel",
    type: "CNAME",
    content: "tunnel.cfargotunnel.com",
  };
  const fixture = dnsFixture([owned, live, foreign, tunnel]);
  await cleanupCloudflareDnsTransition({
    appId: "stack",
    previous: {
      apiToken: "test-token",
      hostnames: [owned.name, live.name, owned.name],
    },
    protectedHostnames: ["LIVE.EXAMPLE.COM"],
    fetcher: fixture.fetcher,
  });
  assert.deepEqual([...fixture.records.values()], [live, foreign, tunnel]);
  assert.deepEqual(fixture.mutations, [{ method: "DELETE", name: owned.name }]);
});
