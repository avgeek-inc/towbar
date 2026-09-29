import assert from "node:assert/strict";
import test from "node:test";
import { normalizeDeploymentManifest } from "@workspace/towbar-core";
import { getServiceDomains } from "./service-domains";

const service = {
  id: "web",
  name: "Website",
  server: "192.0.2.10",
  dockerfile: "Dockerfile",
  container: { port: 3000 },
  domains: {
    primary: "example.com",
    redirects: [
      { host: "www.example.com", status: 301 as const },
      { host: "old.example.com", status: 302 as const },
    ],
  },
};

void test("service domain rows preserve primary routes and alternate redirect targets", () => {
  const config = normalizeDeploymentManifest({
    version: 2,
    apps: [{ ...service, tls: { mode: "cloudflare-dns" } }],
  }).apps[0]!;
  const rows = getServiceDomains(config);
  assert.equal(rows[0]?.role, "Primary");
  assert.deepEqual(rows[0]?.target, {
    kind: "service",
    name: "Website",
    port: 3000,
    ingress: "proxy",
  });
  assert.deepEqual(
    rows
      .slice(1)
      .map(({ hostname, role, target }) => ({ hostname, role, target })),
    service.domains.redirects
      .slice()
      .sort((left, right) => left.host.localeCompare(right.host))
      .map(({ host, status }) => ({
        hostname: host,
        role: "Alternate",
        target: { kind: "redirect", hostname: "example.com", status },
      })),
  );
  assert(rows.every(({ tls }) => tls === "cloudflare-dns"));
});

void test("legacy TLS defaults to direct and Tunnel routes use edge TLS", () => {
  const direct = normalizeDeploymentManifest({ version: 2, apps: [service] })
    .apps[0]!;
  assert(getServiceDomains(direct).every(({ tls }) => tls === "direct"));
  const tunnel = normalizeDeploymentManifest({
    version: 2,
    apps: [
      {
        ...service,
        ingress: { type: "cloudflare-tunnel", integration: "cloudflare" },
      },
    ],
  }).apps[0]!;
  assert(
    getServiceDomains(tunnel).every(({ tls }) => tls === "cloudflare-tunnel"),
  );
});

void test("Compose domains all route to their service and aliases are not redirects", () => {
  const config = normalizeDeploymentManifest({
    version: 2,
    compose: [
      {
        id: "stack",
        name: "Stack",
        server: "192.0.2.10",
        file: "compose.yml",
        services: {
          web: { port: 3000, domains: ["web.example.com", "shop.example.com"] },
          api: {
            port: 8080,
            domains: ["api.example.com"],
            tls: { mode: "cloudflare-dns" },
          },
          cache: {},
          admin: {
            port: 3001,
            domains: ["admin.example.com"],
            ingress: { type: "cloudflare-tunnel", integration: "cloudflare" },
          },
        },
      },
    ],
  }).compose![0]!;
  const rows = getServiceDomains(config);
  assert.deepEqual(
    rows.map(({ hostname, tls }) => [hostname, tls]),
    [
      ["admin.example.com", "cloudflare-tunnel"],
      ["api.example.com", "cloudflare-dns"],
      ["web.example.com", "direct"],
      ["shop.example.com", "direct"],
    ],
  );
  assert(rows.every(({ role, target }) => !role && target.kind === "compose"));
  assert.deepEqual(rows[2]?.target, rows[3]?.target);
});

void test("services and Compose projects without public domains return an empty list", () => {
  const { domains: _domains, ...internal } = service;
  const manifest = normalizeDeploymentManifest({
    version: 2,
    apps: [internal],
    compose: [
      {
        id: "stack",
        name: "Stack",
        server: "192.0.2.10",
        file: "compose.yml",
        services: { worker: {}, cache: {} },
      },
    ],
  });
  assert.deepEqual(getServiceDomains(manifest.apps[0]!), []);
  assert.deepEqual(getServiceDomains(manifest.compose![0]!), []);
});
