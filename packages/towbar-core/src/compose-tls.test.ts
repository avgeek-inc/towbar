import assert from "node:assert/strict";
import test from "node:test";
import { stringify } from "yaml";
import { deploymentCloudflareDnsDomains } from "./cloudflare-dns.js";
import { normalizeDeploymentManifest } from "./manifest.js";
import type { DeploymentManifestInput } from "./manifest.js";
import { resolveRepositoryEnvironment } from "./manifest-v2.js";

const compose = {
  id: "stack",
  name: "Stack",
  server: "192.0.2.10",
  file: "compose.yml",
  services: {
    api: {
      port: 3000,
      domains: ["API.Example.COM"],
      ingress: { type: "proxy" },
      tls: { mode: "cloudflare-dns" },
    },
    web: { port: 8080, domains: ["web.example.com"], tls: { mode: "direct" } },
    cache: {},
  },
} satisfies NonNullable<DeploymentManifestInput["compose"]>[number];

void test("Compose preserves route TLS modes and normalizes domains", () => {
  const app = normalizeDeploymentManifest({ version: 2, compose: [compose] })
    .compose![0]!;
  assert.equal(app.services.api?.tls?.mode, "cloudflare-dns");
  assert.equal(app.services.web?.tls?.mode, "direct");
  assert.deepEqual(app.services.api?.domains, ["api.example.com"]);
  assert.deepEqual(deploymentCloudflareDnsDomains(app), ["api.example.com"]);
  assert.equal(app.tls, undefined);
  const legacy = normalizeDeploymentManifest({
    version: 2,
    compose: [
      {
        ...compose,
        services: { web: { port: 8080, domains: ["web.example.com"] } },
      },
    ],
  }).compose![0]!;
  assert.equal(legacy.services.web?.tls, undefined);
  assert.deepEqual(deploymentCloudflareDnsDomains(legacy), []);
});

void test("Compose TLS supports deep environment overrides without changing sibling routes", () => {
  const { server: _server, ...defaults } = compose;
  const { manifest } = resolveRepositoryEnvironment({
    root: stringify({ version: 2, environments: { production: {} } }),
    branch: "main",
    environment: "production",
    files: [
      {
        path: ".towbar/services/stack.compose.yml",
        content: stringify({
          ...defaults,
          environments: {
            production: {
              server: compose.server,
              services: { web: { tls: { mode: "cloudflare-dns" } } },
            },
          },
        }),
      },
    ],
  });
  assert.deepEqual(deploymentCloudflareDnsDomains(manifest.compose![0]!), [
    "api.example.com",
    "web.example.com",
  ]);
});

void test("Compose rejects TLS without domains and explicit TLS on a Tunnel route", () => {
  for (const policy of [
    { tls: { mode: "cloudflare-dns" } },
    { tls: { mode: "direct" }, domains: [] },
    {
      port: 8080,
      domains: ["web.example.com"],
      ingress: { type: "cloudflare-tunnel", integration: "cloudflare" },
      tls: { mode: "cloudflare-dns" },
    },
    {
      port: 8080,
      domains: ["web.example.com"],
      ingress: { type: "cloudflare-tunnel", integration: "cloudflare" },
      tls: { mode: "direct" },
    },
  ] satisfies NonNullable<
    NonNullable<DeploymentManifestInput["compose"]>[number]["services"]
  >[string][])
    assert.throws(() =>
      normalizeDeploymentManifest({
        version: 2,
        compose: [{ ...compose, services: { web: policy } }],
      }),
    );
});

void test("Compose DNS routes retain domain ownership checks across services and workloads", () => {
  assert.throws(
    () =>
      normalizeDeploymentManifest({
        version: 2,
        compose: [
          {
            ...compose,
            services: {
              api: compose.services.api,
              web: { ...compose.services.web, domains: ["api.example.com"] },
            },
          },
        ],
      }),
    /already claimed/,
  );
  assert.throws(
    () =>
      normalizeDeploymentManifest({
        version: 2,
        compose: [compose],
        apps: [
          {
            id: "other",
            name: "Other",
            server: "192.0.2.10",
            dockerfile: "Dockerfile",
            container: { port: 3000 },
            domains: { primary: "api.example.com" },
          },
        ],
      }),
    /already claimed/,
  );
  assert.throws(() =>
    normalizeDeploymentManifest({
      version: 2,
      compose: [
        {
          ...compose,
          services: {
            api: {
              ...compose.services.api,
              domains: ["https://api.example.com"],
            },
          },
        },
      ],
    }),
  );
});
