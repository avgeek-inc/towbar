import { parseResolvedManifest } from "./manifest-test-helper.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ManifestValidationError,
  getLatestBackupScheduleOccurrence,
  validateBackupCron,
  validateSecretObject,
  validateServerLoginSecret,
} from "./manifest.js";

const manifest = `
version: 2
source:
  branch: release
deploymentInputs:
  shared-web:
    - packages/web-design-system/**
apps:
  - id: towbar-web-app
    autoDeploy:
      inputs:
        - $shared-web
        - apps/towbar-web-app/**
    vulnerabilityScanning: true
    name: Towbar Web App
    server: 203.0.113.10
    dockerfile: apps/towbar-web-app/Dockerfile
    context: .
    container:
      network: towbar-platform
      port: 3000
      resources:
        cpus: 0.5
        memory: 1G
    hooks:
      preDeploy:
        command: [node, dist/cli/migrate.js]
      postDeploy:
        command: [node, dist/cli/post-deploy.js]
        timeoutSeconds: 120
    domains:
      primary: APP.TOWBAR.DEV.
      redirects:
        - host: old.towbar.dev
    tls:
      mode: cloudflare-dns
    preview:
      enabled: true
      domain: PREVIEW.TOWBAR.DEV.
      ttlHours: 48
`;

const deploymentJsonSchema = JSON.parse(
  readFileSync(new URL("../schemas/app.v2.json", import.meta.url), "utf8"),
) as unknown;

void test("parses and canonicalizes a version 2 resolved manifest", () => {
  const result = parseResolvedManifest(manifest);
  assert.match(result.digest, /^[a-f0-9]{64}$/);
  assert.deepEqual(result.manifest.source, { branch: "release" });
  assert.equal("secrets" in result.manifest, false);
  assert.equal(result.manifest.apps[0]?.autoDeploy, true);
  assert.equal(result.manifest.apps[0]?.vulnerabilityScanning, true);
  assert.deepEqual(result.manifest.apps[0]?.deploymentInputs, [
    "apps/towbar-web-app/**",
    "packages/web-design-system/**",
  ]);
  assert.equal(result.manifest.apps[0]?.sourceBranch, "release");
  assert.equal(result.manifest.apps[0]?.domains?.primary, "app.towbar.dev");
  assert.equal(result.manifest.apps[0]?.domains?.redirects[0]?.status, 301);
  assert.equal(result.manifest.apps[0]?.health.path, "/api/health");
  assert.equal(result.manifest.apps[0]?.container.network, "towbar-platform");
  assert.deepEqual(result.manifest.apps[0]?.container.resources, {
    cpus: 0.5,
    memory: "1g",
  });
  assert.deepEqual(result.manifest.apps[0]?.hooks, {
    postDeploy: {
      command: ["node", "dist/cli/post-deploy.js"],
      timeoutSeconds: 120,
    },
    preDeploy: {
      command: ["node", "dist/cli/migrate.js"],

      timeoutSeconds: 300,
    },
  });
  assert.deepEqual(result.manifest.apps[0]?.preview, {
    domain: "preview.towbar.dev",
    enabled: true,

    ttlHours: 48,
  });
});

void test("rejects unknown deployment input groups and unsafe globs", () => {
  assert.throws(
    () => parseResolvedManifest(manifest.replace("$shared-web", "$missing")),
    /Towbar deployment manifest is invalid/u,
  );
  assert.throws(
    () =>
      parseResolvedManifest(
        manifest.replace(
          "    - packages/web-design-system/**",
          "    - ../outside/**",
        ),
      ),
    /Towbar deployment manifest is invalid/u,
  );
  assert.throws(
    () =>
      parseResolvedManifest(
        manifest.replace(
          "    - packages/web-design-system/**",
          "    - packages/../apps/**",
        ),
      ),
    /Towbar deployment manifest is invalid/u,
  );
  assert.throws(
    () =>
      parseResolvedManifest(
        manifest.replace(
          "    - packages/web-design-system/**",
          "    - packages/web-design-system/**\n    - packages/web-design-system/**",
        ),
      ),
    /Towbar deployment manifest is invalid/u,
  );
});

void test("publishes v2 entity identity, overrides and required secret keys", () => {
  const properties = schemaObject(deploymentJsonSchema, "properties");
  assert.equal(properties.source, undefined);
  assert.equal(properties.servers, undefined);
  assert.equal(properties.dependsOn, undefined);
  assert.deepEqual(schemaObject(deploymentJsonSchema).required, [
    "id",
    "name",
    "environments",
  ]);
  assert.equal(
    schemaObject(properties.environments, "additionalProperties")
      .additionalProperties,
    false,
  );
  const overrides = schemaObject(
    properties.environments,
    "additionalProperties",
    "properties",
  );
  for (const key of ["id", "name", "type", "preview", "secrets"])
    assert.equal(overrides[key], undefined);
  assert.equal(schemaObject(properties.secrets).additionalProperties, false);
  assert.equal(
    schemaObject(
      properties.container,
      "properties",
      "resources",
      "properties",
      "memory",
    ).type,
    "string",
  );
});

void test("normalizes image, PostgreSQL, and Redis resources", () => {
  const source = `${manifest}\nresources:\n  - id: metrics\n    name: Metrics\n    type: image\n    image: prom/prometheus:v3.5.0\n    server: 203.0.113.10\n    container:\n      port: 9090\n      volumes:\n        - name: config\n          mountPath: /prometheus\n    health:\n      type: http\n      path: /-/healthy\n  - id: database\n    name: Database\n    type: postgres\n    server: 203.0.113.10\n    access:\n      sshTunnel:\n        hostPort: 15432\n    backup:\n      schedule:\n        cron: "0 3 * * *"\n      retention:\n        keepLast: 14\n      s3:\n        bucket: example-production-backups\n        prefix: databases\n    container:\n      network: towbar-platform\n  - id: cache\n    name: Cache\n    type: redis\n    server: 203.0.113.10\n`;
  const parsed = parseResolvedManifest(source).manifest;
  const [cache, database, metrics] = parsed.resources ?? [];
  assert.equal(cache?.image, "redis:8-alpine");
  assert.equal(cache?.container.port, 6_379);
  assert.deepEqual(cache?.container.volumes, [
    { mountPath: "/data", name: "data" },
  ]);
  assert.equal(database?.image, "postgres:17-alpine");
  assert.deepEqual(database?.container.volumes, [
    { mountPath: "/var/lib/postgresql/data", name: "data" },
  ]);
  assert.equal(database?.health.type, "command");
  assert.deepEqual(database?.access, {
    sshTunnel: { hostPort: 15_432 },
  });
  assert.equal(database?.container.networkAlias, "database");
  assert.deepEqual(database?.backup, {
    restoreFrom: "s3",
    retention: { keepLast: 14 },
    s3: {
      bucket: "example-production-backups",
      encryption: "AES256",
      prefix: "databases",
    },
    schedule: { cron: "0 3 * * *", timezone: "UTC" },
  });
  assert.equal(metrics?.image, "prom/prometheus:v3.5.0");
  assert.equal(metrics?.health.type, "http");
});

void test("uses the PostgreSQL 18 data root for managed volumes", () => {
  const parsed = parseResolvedManifest(
    `${manifest}\nresources:\n  - id: database\n    name: Database\n    type: postgres\n    image: postgres:18-alpine\n    server: 203.0.113.10\n`,
  ).manifest;

  assert.deepEqual(parsed.resources?.[0]?.container.volumes, [
    { mountPath: "/var/lib/postgresql", name: "data" },
  ]);
});

void test("validates hourly-or-slower UTC backup cron schedules", () => {
  assert.doesNotThrow(() => validateBackupCron("0 * * * *"));
  assert.equal(
    getLatestBackupScheduleOccurrence(
      "0 3 * * *",
      new Date("2026-08-20T03:04:59.000Z"),
    )?.toISOString(),
    "2026-08-20T03:00:00.000Z",
  );
  assert.throws(
    () => validateBackupCron("*/30 * * * *"),
    /cannot run more than once per hour/u,
  );
  assert.throws(() => validateBackupCron("0 0 3 * * *"));
});

void test("rejects removed terminal declarations", () => {
  assert.throws(
    () =>
      parseResolvedManifest(
        manifest.replace(
          "    tls:\n      mode: cloudflare-dns",
          "    terminal:\n      enabled: true\n    tls:\n      mode: cloudflare-dns",
        ),
      ),
    ManifestValidationError,
  );
});

void test("rejects mutable resource images and duplicate deployable ids", () => {
  const mutable = `${manifest}\nresources:\n  - id: metrics\n    name: Metrics\n    type: image\n    image: prom/prometheus:latest\n    server: 203.0.113.10\n`;
  assert.throws(() => parseResolvedManifest(mutable), ManifestValidationError);
  const separateKinds = `${manifest}\nresources:\n  - id: towbar-web-app\n    name: Redis\n    type: redis\n    server: 203.0.113.10\n`;
  assert.doesNotThrow(() => parseResolvedManifest(separateKinds));
  const duplicate = `${separateKinds}  - id: towbar-web-app\n    name: Duplicate\n    type: redis\n    server: 203.0.113.11\n`;
  assert.throws(
    () => parseResolvedManifest(duplicate),
    ManifestValidationError,
  );
});

void test("rejects unsafe or conflicting Resource connectivity declarations", () => {
  const resource = `\nresources:\n  - id: database\n    name: Database\n    type: postgres\n    server: 203.0.113.10\n    access:\n      sshTunnel:\n        hostPort: 15432\n    container:\n      network: towbar-platform\n      networkAlias: shared-database\n`;
  assert.doesNotThrow(() => parseResolvedManifest(`${manifest}${resource}`));
  assert.throws(
    () =>
      parseResolvedManifest(
        `${manifest}${resource.replace("      network: towbar-platform\n", "")}`,
      ),
    ManifestValidationError,
  );
  assert.throws(
    () =>
      parseResolvedManifest(
        `${manifest}\nresources:\n  - id: metrics\n    name: Metrics\n    type: image\n    image: prom/prometheus:v3.5.0\n    server: 203.0.113.10\n    access:\n      sshTunnel:\n        hostPort: 15432\n`,
      ),
    ManifestValidationError,
  );
  assert.throws(
    () =>
      parseResolvedManifest(
        `${manifest}${resource}  - id: analytics\n    name: Analytics\n    type: postgres\n    server: 203.0.113.10\n    access:\n      sshTunnel:\n        hostPort: 15432\n    container:\n      network: towbar-platform\n      networkAlias: analytics\n`,
      ),
    ManifestValidationError,
  );
  assert.throws(
    () =>
      parseResolvedManifest(
        `${manifest}${resource}  - id: analytics\n    name: Analytics\n    type: postgres\n    server: 203.0.113.10\n    container:\n      network: towbar-platform\n      networkAlias: shared-database\n`,
      ),
    ManifestValidationError,
  );
});

void test("normalizes Resource image, command, health, volumes, and shared runtime secrets", () => {
  const parsed = parseResolvedManifest(
    `${manifest}\nresources:\n  - id: metrics\n    name: Metrics\n    type: image\n    image: prom/prometheus:v3.5.0\n    server: 203.0.113.10\n    container:\n      command: [--config.file=/etc/prometheus/prometheus.yml]\n      port: 9090\n      volumes:\n        - name: data\n          mountPath: /prometheus\n    health:\n      type: http\n      path: /-/healthy\n`,
  ).manifest;
  const resource = parsed.resources?.[0];
  assert.ok(resource);
  assert.equal(resource.image, "prom/prometheus:v3.5.0");
  assert.deepEqual(resource.container.command, [
    "--config.file=/etc/prometheus/prometheus.yml",
  ]);
  assert.deepEqual(resource.health, {
    path: "/-/healthy",
    timeoutSeconds: 60,
    type: "http",
  });
  assert.deepEqual(resource.container.volumes, [
    { mountPath: "/prometheus", name: "data" },
  ]);
  assert.equal("sharedSecrets" in resource, false);
});

void test("defaults to main and rejects unsafe branch names", () => {
  const defaulted = parseResolvedManifest(
    manifest.replace("source:\n  branch: release\n", ""),
  );
  assert.deepEqual(defaulted.manifest.source, { branch: "main" });
  assert.equal(defaulted.manifest.apps[0]?.sourceBranch, "main");
  assert.throws(
    () =>
      parseResolvedManifest(
        manifest.replace("branch: release", "branch: ../main"),
      ),
    ManifestValidationError,
  );
});

void test("rejects server configuration in the manifest", () => {
  assert.throws(
    () =>
      parseResolvedManifest(
        `${manifest}\nservers:\n  - ip: 203.0.113.10\n    ssh:\n      username: deploy\n`,
      ),
    ManifestValidationError,
  );
});

void test("rejects duplicate YAML keys before reconciliation", () => {
  assert.throws(
    () => parseResolvedManifest("version: 2\nversion: 2\napps: []"),
    ManifestValidationError,
  );
});

void test("rejects duplicate app ids and domain claims", () => {
  const duplicate = manifest.replace(
    "    tls:\n      mode: cloudflare-dns",
    `    tls:\n      mode: cloudflare-dns\n  - id: towbar-web-app\n    name: Duplicate\n    server: 203.0.113.10\n    dockerfile: Dockerfile\n    container:\n      port: 3000\n    domains:\n      primary: app.towbar.dev`,
  );
  assert.throws(
    () => parseResolvedManifest(duplicate),
    (error) => {
      assert.ok(error instanceof ManifestValidationError);
      assert.ok(
        error.issues.some((issue) =>
          issue.message.includes("declared more than once"),
        ),
      );
      assert.ok(
        error.issues.some((issue) => issue.message.includes("already claimed")),
      );
      return true;
    },
  );
});

void test("rejects a Dockerfile that escapes its build context", () => {
  const invalid = manifest.replace(
    "dockerfile: apps/towbar-web-app/Dockerfile",
    "dockerfile: ../Dockerfile",
  );
  assert.throws(() => parseResolvedManifest(invalid), ManifestValidationError);
});

void test("rejects an unsafe Docker network name", () => {
  const invalid = manifest.replace(
    "network: towbar-platform",
    "network: --network=host",
  );
  assert.throws(() => parseResolvedManifest(invalid), ManifestValidationError);
});

void test("rejects invalid container resource limits", () => {
  const invalid = manifest.replace("memory: 1G", "memory: unlimited");
  assert.throws(() => parseResolvedManifest(invalid), ManifestValidationError);
});

void test("rejects the removed dependsOn manifest field", () => {
  const invalid = manifest.replace(
    "    context: .\n",
    "    context: .\n    dependsOn: [api]\n",
  );
  assert.throws(
    () => parseResolvedManifest(invalid),
    (error) => {
      assert.ok(error instanceof ManifestValidationError);
      assert.ok(
        error.issues.some((issue) => issue.message.includes("dependsOn")),
      );
      return true;
    },
  );
});

void test("validates secret payload shapes without retaining values", () => {
  assert.deepEqual(
    validateSecretObject({ API_URL: "https://example.com" }, "deployment"),
    { API_URL: "https://example.com" },
  );
  assert.throws(() => validateSecretObject({ "bad-key": "value" }, "build"));
  assert.deepEqual(validateServerLoginSecret({ privateKey: "private-key" }), {
    privateKey: "private-key",
  });
  assert.throws(() =>
    validateServerLoginSecret({
      privateKey: "private-key",
      passphrase: "unsupported-in-v1",
    }),
  );
  assert.throws(() => validateServerLoginSecret({ password: "not-supported" }));
});

function schemaObject(value: unknown, ...path: string[]) {
  let current = value;
  for (const part of path) {
    assert.ok(
      current && typeof current === "object" && !Array.isArray(current),
    );
    current = (current as Record<string, unknown>)[part];
  }
  assert.ok(current && typeof current === "object" && !Array.isArray(current));
  return current as Record<string, unknown>;
}

void test("normalizes an explicit App alias and rejects unsafe sharing", () => {
  const base = `version: 2
apps:
  - id: api
    name: API
    server: 203.0.113.10
    dockerfile: Dockerfile
    container:
      network: private-app
      networkAlias: api
      port: 4013
`;
  assert.equal(
    parseResolvedManifest(base).manifest.apps[0]?.container.networkAlias,
    "api",
  );
  assert.throws(
    () =>
      parseResolvedManifest(base.replace("      network: private-app\n", "")),
    (error: unknown) =>
      error instanceof ManifestValidationError &&
      error.issues.some((issue) =>
        /requires a Docker network/u.test(issue.message),
      ),
  );
  assert.throws(
    () =>
      parseResolvedManifest(
        base.replace("networkAlias: api", "networkAlias: --invalid"),
      ),
    ManifestValidationError,
  );
  assert.throws(
    () =>
      parseResolvedManifest(
        `${base}    domains:\n      primary: api.example.com\n    tls:\n      mode: direct\n    preview:\n      enabled: true\n      domain: preview.example.com\n`,
      ),
    (error: unknown) =>
      error instanceof ManifestValidationError &&
      error.issues.some((issue) =>
        /cannot enable Preview/u.test(issue.message),
      ),
  );
  assert.throws(
    () =>
      parseResolvedManifest(
        `${base}resources:\n  - id: database\n    name: Database\n    server: 203.0.113.10\n    type: postgres\n    container:\n      network: private-app\n      networkAlias: api\n`,
      ),
    (error: unknown) =>
      error instanceof ManifestValidationError &&
      error.issues.some((issue) => /already claimed/u.test(issue.message)),
  );
  assert.throws(
    () =>
      parseResolvedManifest(
        `${base}  - id: other\n    name: Other API\n    server: 203.0.113.10\n    dockerfile: Dockerfile\n    container:\n      network: private-app\n      networkAlias: api\n      port: 4013\n`,
      ),
    (error: unknown) =>
      error instanceof ManifestValidationError &&
      error.issues.some((issue) => /already claimed/u.test(issue.message)),
  );
});
