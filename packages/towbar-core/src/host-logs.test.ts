import assert from "node:assert/strict";
import { test } from "node:test";
import { stringify } from "yaml";
import { collectsHostDockerLogs } from "./host-logs.js";
import {
  appSchema,
  digestValue,
  normalizeServerConfiguration,
} from "./manifest.js";
import { resolveRepositoryEnvironment } from "./manifest-v2.js";
import { composeWorkloadSchema } from "./platform-expansion.js";

const collector = {
  id: "host-logs",
  name: "Host logs",
  dockerfile: "observability/fluent-bit/Dockerfile",
  rollout: {
    type: "recreate",
    maintenanceMode: true,
    reason: "One collector writes the persistent cursor and buffer",
  },
  container: {
    port: 2020,
    resources: { cpus: 0.25, memory: "256m" },
    hostLogs: { dockerJsonFiles: true },
    volumes: [{ name: "state", mountPath: "/var/lib/fluent-bit" }],
  },
  health: { path: "/api/v1/health", timeoutSeconds: 60 },
  environments: { production: { server: "192.0.2.10" } },
};

void test("resolves an explicit collector Service without enabling its server", () => {
  const { manifest } = resolveRepositoryEnvironment({
    root: "version: 2\nenvironments:\n  production: {}",
    environment: "production",
    branch: "main",
    files: [
      {
        path: ".towbar/services/host-logs.service.yml",
        content: stringify(collector),
      },
    ],
  });
  assert.equal(collectsHostDockerLogs(manifest.apps[0]!), true);
  assert.deepEqual(manifest.apps[0]!.container.hostLogs, {
    dockerJsonFiles: true,
  });
  assert.equal(
    normalizeServerConfiguration({
      ip: manifest.apps[0]!.server,
      ssh: { username: "ubuntu" },
    }).hostLogCollection,
    undefined,
  );
  const plain = { ...manifest.apps[0]!, container: { port: 2020 } };
  assert.equal(collectsHostDockerLogs(plain), false);
});

void test("server opt-in is explicit and disabled servers keep their existing digest", () => {
  const base = { ip: "192.0.2.10", ssh: { username: "ubuntu" } };
  const omitted = normalizeServerConfiguration(base);
  assert.deepEqual(
    normalizeServerConfiguration({ ...base, hostLogCollection: false }),
    omitted,
  );
  const enabled = normalizeServerConfiguration({
    ...base,
    hostLogCollection: true,
  });
  assert.equal(enabled.hostLogCollection, true);
  assert.notEqual(digestValue(enabled), digestValue(omitted));
});

void test("collectors require bounded resources, persistent storage and one writer", () => {
  const app = { ...collector, server: "192.0.2.10" };
  const { environments: _environments, ...resolved } = app;
  assert.equal(appSchema.safeParse(resolved).success, true);
  const cases: unknown[] = [
    { ...resolved, container: { ...resolved.container, resources: undefined } },
    { ...resolved, container: { ...resolved.container, volumes: [] } },
    { ...resolved, rollout: undefined },
    { ...resolved, rollout: { type: "rolling" } },
    { ...resolved, rollout: { ...resolved.rollout, maintenanceMode: false } },
    { ...resolved, preview: { enabled: true, domain: "preview.example.com" } },
    ...[
      "/var/lib",
      "/var/lib/docker/containers",
      "/var/lib/docker/containers/state",
    ].map((mountPath) => ({
      ...resolved,
      container: {
        ...resolved.container,
        volumes: [{ name: "state", mountPath }],
      },
    })),
  ];
  for (const candidate of cases)
    assert.equal(appSchema.safeParse(candidate).success, false);
});

void test("host-log capability cannot select paths, writable access, sockets or Compose", () => {
  const { environments: _environments, ...resolved } = {
    ...collector,
    server: "192.0.2.10",
  };
  for (const hostLogs of [
    { dockerJsonFiles: false },
    { dockerJsonFiles: true, readOnly: false },
    { dockerJsonFiles: true, source: "/etc" },
    { dockerJsonFiles: true, dockerSocket: true },
  ])
    assert.equal(
      appSchema.safeParse({
        ...resolved,
        container: { ...resolved.container, hostLogs },
      }).success,
      false,
    );
  assert.equal(
    appSchema.safeParse({
      ...resolved,
      container: {
        ...resolved.container,
        volumes: [
          {
            name: "state",
            mountPath: "/var/lib/fluent-bit",
            source: "/srv/state",
          },
        ],
      },
    }).success,
    false,
  );
  assert.equal(
    composeWorkloadSchema.safeParse({
      id: "logs",
      name: "Logs",
      server: "192.0.2.10",
      file: "compose.yml",
      hostLogs: { dockerJsonFiles: true },
    }).success,
    false,
  );
});
