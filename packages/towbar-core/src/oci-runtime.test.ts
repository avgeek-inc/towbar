import assert from "node:assert/strict";
import test from "node:test";
import {
  appSchema,
  normalizeDeploymentManifest,
  resourceSchema,
} from "./manifest.js";
import { validateConfigurationSources } from "./container-configuration.js";

const service = {
  id: "collector",
  name: "Collector",
  server: "192.0.2.1",
  deployment: { type: "image" as const, image: "example/collector:1" },
  container: { port: 4318 },
  rollout: {
    type: "recreate" as const,
    maintenanceMode: false,
    reason: "Independent service",
  },
};

void test("normalizes independent OCI services, hook entrypoints, and datastore files", () => {
  const app = {
    ...service,
    autoDeploy: { inputs: ["app/**"] },
    container: {
      port: 4318,
      entrypoint: "/bin/sh",
      command: ["-ec", "exec collector"],
      configFiles: [
        { source: "config/collector.yml", mountPath: "/etc/collector.yml" },
      ],
    },
    health: { type: "http" as const, path: "/", port: 13133 },
    hooks: {
      preDeploy: {
        entrypoint: "/bin/sh",
        command: [
          "-ec",
          "migrate ready && migrate bootstrap && migrate sync up && migrate async up",
        ],
      },
    },
  };
  const result = normalizeDeploymentManifest({
    version: 2,
    apps: [app],
    resources: [
      {
        id: "store",
        name: "Store",
        type: "clickhouse",
        server: service.server,
        container: {
          configFiles: [
            {
              source: "config/histogram",
              mountPath: "/var/lib/clickhouse/user_scripts/histogram",
              mode: "0555",
            },
          ],
        },
      },
    ],
  });
  assert.deepEqual(result.apps[0]!.deploymentInputs, [
    "app/**",
    "config/collector.yml",
  ]);
  assert.equal(result.apps[0]!.hooks.preDeploy?.entrypoint, "/bin/sh");
  assert.deepEqual(result.apps[0]!.health, {
    path: "/",
    port: 13133,
    timeoutSeconds: 60,
  });
  assert.equal(result.resources![0]!.container.configFiles![0]!.mode, "0555");
  assert.deepEqual(
    normalizeDeploymentManifest({ version: 2, apps: [service] }).apps[0]!
      .health,
    { path: "/api/health", timeoutSeconds: 60 },
  );
});

void test("admits command/container service health and requires a separate public probe", () => {
  for (const health of [
    { type: "container" as const },
    { type: "command" as const, command: ["keeper-client", "ls"] },
  ]) {
    assert(appSchema.safeParse({ ...service, health }).success);
    assert(
      !appSchema.safeParse({
        ...service,
        health,
        domains: { primary: "collector.example.com" },
      }).success,
    );
    assert(
      appSchema.safeParse({
        ...service,
        health: { ...health, publicPath: "/status" },
        domains: { primary: "collector.example.com" },
      }).success,
    );
  }
  assert(
    !appSchema.safeParse({
      ...service,
      health: { path: "/", port: 13133 },
      domains: { primary: "collector.example.com" },
    }).success,
  );
  assert(
    !appSchema.safeParse({
      ...service,
      health: { type: "command", command: ["true"], port: 13133 },
    }).success,
  );
});

void test("rejects unsafe file sources, targets, collisions, and host-mount declarations", () => {
  const file = { source: "config/server.yml", mountPath: "/etc/server.yml" };
  for (const source of [
    "../secret",
    "/etc/passwd",
    "config/../secret",
    "config//file",
    "config/*",
    "config/./file",
    "a\\b",
  ])
    assert(
      !appSchema.safeParse({
        ...service,
        container: { ...service.container, configFiles: [{ ...file, source }] },
      }).success,
      source,
    );
  for (const mountPath of [
    "/",
    "/etc/../file",
    "/proc/file",
    "/var/run/docker.sock",
    "/etc/server.yml/",
    "/etc//file",
  ])
    assert(
      !appSchema.safeParse({
        ...service,
        container: {
          ...service.container,
          configFiles: [{ ...file, mountPath }],
        },
      }).success,
      mountPath,
    );
  for (const mountPath of [file.mountPath, file.mountPath + "/child"])
    assert(
      !appSchema.safeParse({
        ...service,
        container: {
          ...service.container,
          configFiles: [file, { ...file, mountPath }],
        },
      }).success,
    );
  assert(
    !resourceSchema.safeParse({
      id: "store",
      name: "Store",
      type: "redis",
      server: service.server,
      container: {
        configFiles: [{ ...file, mountPath: "/data" }],
        volumes: [{ name: "data", mountPath: "/data" }],
      },
    }).success,
  );
  assert(
    !appSchema.safeParse({
      ...service,
      container: {
        ...service.container,
        configFiles: [{ ...file, hostPath: "/etc/passwd" }],
      },
    }).success,
  );
});

void test("requires regular files in a complete immutable source tree", () => {
  const files = [{ source: "config/server.yml", mountPath: "/etc/server.yml" }];
  for (const mode of ["120000", "160000"])
    assert.throws(
      () =>
        validateConfigurationSources(files, {
          complete: true,
          entries: [{ path: files[0]!.source, mode, type: "blob", sha: "x" }],
        }),
      /regular repository file/,
    );
  assert.throws(
    () => validateConfigurationSources(files, { complete: false, entries: [] }),
    /complete repository tree/,
  );
  assert.throws(
    () => validateConfigurationSources(files, { complete: true, entries: [] }),
    /regular repository file/,
  );
  validateConfigurationSources(files, {
    complete: true,
    entries: [
      { path: files[0]!.source, mode: "100644", type: "blob", sha: "x" },
    ],
  });
});
