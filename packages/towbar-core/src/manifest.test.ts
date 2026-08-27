import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ManifestValidationError,
  getLatestBackupScheduleOccurrence,
  parseDeploymentManifest,
  validateBackupCron,
  validateSecretObject,
  validateServerLoginSecret,
} from "./manifest.js";

const manifest = `
version: 1
source:
  branch: release
deploymentInputs:
  shared-web:
    - packages/web-design-system/**
secrets:
  build:
    - aws:example/production/shared/frontend-build
  deployment:
    - aws:example/production/shared/runtime
servers:
  - ip: 203.0.113.10
    buildConcurrency: 3
    ssh:
      host: 10.0.0.10
      username: deploy
    secrets:
      login: aws:example/production/server/login
    proxy:
      cloudflare:
        apiToken: aws:example/production/cloudflare/dns
apps:
  - id: towbar-web-app
    autoDeploy:
      inputs:
        - $shared-web
        - apps/towbar-web-app/**
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
    secrets:
      build: aws:example/production/towbar-web-app/build
      deployment: aws:example/production/towbar-web-app/deployment
    hooks:
      preDeploy:
        command: [node, dist/cli/migrate.js]
        secrets: aws:example/production/towbar-database/migration
      postDeploy:
        command: [node, dist/cli/post-deploy.js]
        timeoutSeconds: 120
    domains:
      primary: APP.TOWBAR.DEV.
      redirects:
        - host: old.towbar.dev
    tls:
      mode: cloudflare-dns
`;

const deploymentJsonSchema = JSON.parse(
  readFileSync(
    new URL("../schemas/deployment.v1.json", import.meta.url),
    "utf8",
  ),
) as unknown;

void test("parses and canonicalizes a version 1 manifest", () => {
  const result = parseDeploymentManifest(manifest);
  assert.match(result.digest, /^[a-f0-9]{64}$/);
  assert.equal(result.manifest.servers[0]?.ssh.port, 22);
  assert.equal(result.manifest.servers[0]?.ssh.host, "10.0.0.10");
  assert.equal(result.manifest.servers[0]?.buildConcurrency, 3);
  assert.deepEqual(result.manifest.source, { branch: "release" });
  assert.deepEqual(result.manifest.secrets, {
    build: ["aws:example/production/shared/frontend-build"],
    deployment: ["aws:example/production/shared/runtime"],
  });
  assert.equal(result.manifest.apps[0]?.autoDeploy, true);
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
      secrets: "aws:example/production/towbar-database/migration",
      timeoutSeconds: 300,
    },
  });
});

void test("rejects unknown deployment input groups and unsafe globs", () => {
  assert.throws(
    () => parseDeploymentManifest(manifest.replace("$shared-web", "$missing")),
    /Towbar deployment manifest is invalid/u,
  );
  assert.throws(
    () =>
      parseDeploymentManifest(
        manifest.replace(
          "    - packages/web-design-system/**",
          "    - ../outside/**",
        ),
      ),
    /Towbar deployment manifest is invalid/u,
  );
  assert.throws(
    () =>
      parseDeploymentManifest(
        manifest.replace(
          "    - packages/web-design-system/**",
          "    - packages/../apps/**",
        ),
      ),
    /Towbar deployment manifest is invalid/u,
  );
  assert.throws(
    () =>
      parseDeploymentManifest(
        manifest.replace(
          "    - packages/web-design-system/**",
          "    - packages/web-design-system/**\n    - packages/web-design-system/**",
        ),
      ),
    /Towbar deployment manifest is invalid/u,
  );
});

void test("publishes container resource limits in the JSON schema", () => {
  const sshProperties = schemaObject(
    deploymentJsonSchema,
    "properties",
    "servers",
    "items",
    "properties",
    "ssh",
    "properties",
  );
  const containerProperties = schemaObject(
    deploymentJsonSchema,
    "properties",
    "apps",
    "items",
    "properties",
    "container",
    "properties",
  );
  assert.equal(sshProperties.resources, undefined);
  assert.deepEqual(sshProperties.host, { type: "string" });
  assert.deepEqual(
    schemaObject(containerProperties.resources, "properties").memory,
    {
      pattern: "^\\d+(?:\\.\\d+)?[bBkKmMgG]$",
      type: "string",
    },
  );
});

void test("publishes server concurrency and hooks in the JSON schema", () => {
  const rootProperties = schemaObject(deploymentJsonSchema, "properties");
  const serverProperties = schemaObject(
    deploymentJsonSchema,
    "properties",
    "servers",
    "items",
    "properties",
  );
  const appProperties = schemaObject(
    deploymentJsonSchema,
    "properties",
    "apps",
    "items",
    "properties",
  );
  assert.deepEqual(serverProperties.buildConcurrency, {
    default: 1,
    maximum: 16,
    minimum: 1,
    type: "integer",
  });
  assert.equal(appProperties.dependsOn, undefined);
  assert.equal(schemaObject(appProperties.hooks).minProperties, 1);
  assert.deepEqual(schemaObject(rootProperties.source, "properties").branch, {
    default: "main",
    maxLength: 255,
    minLength: 1,
    type: "string",
  });
  assert.equal(schemaObject(appProperties.autoDeploy).default, false);
  const autoDeployVariants = schemaObject(appProperties.autoDeploy).oneOf;
  assert.ok(Array.isArray(autoDeployVariants));
  assert.equal(autoDeployVariants.length, 2);
  assert.equal(
    schemaObject(rootProperties.deploymentInputs, "additionalProperties")
      .uniqueItems,
    true,
  );
  assert.equal(
    schemaObject(rootProperties.secrets, "properties", "build").uniqueItems,
    true,
  );
  assert.deepEqual(
    schemaObject(rootProperties.resources, "items", "properties").type,
    { enum: ["image", "postgres", "redis"] },
  );
  assert.deepEqual(
    schemaObject(rootProperties.resources, "items", "properties").backup,
    { $ref: "#/$defs/resourceBackup" },
  );
  const resourceProperties = schemaObject(
    rootProperties.resources,
    "items",
    "properties",
  );
  assert.equal(resourceProperties.dependsOn, undefined);
  assert.deepEqual(
    schemaObject(
      resourceProperties.access,
      "properties",
      "sshTunnel",
      "properties",
    ).hostPort,
    { maximum: 65_535, minimum: 1_024, type: "integer" },
  );
  assert.deepEqual(
    schemaObject(resourceProperties.container, "properties").networkAlias,
    {
      pattern: "^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$",
      type: "string",
    },
  );
});

void test("normalizes image, PostgreSQL, and Redis resources", () => {
  const source = `${manifest}\nresources:\n  - id: metrics\n    name: Metrics\n    type: image\n    image: prom/prometheus:v3.5.0\n    server: 203.0.113.10\n    container:\n      port: 9090\n      volumes:\n        - name: config\n          mountPath: /prometheus\n    health:\n      type: http\n      path: /-/healthy\n  - id: database\n    name: Database\n    type: postgres\n    server: 203.0.113.10\n    access:\n      sshTunnel:\n        hostPort: 15432\n    backup:\n      schedule:\n        cron: "0 3 * * *"\n      retention:\n        keepLast: 14\n      s3:\n        bucket: example-production-backups\n        prefix: databases\n    container:\n      network: towbar-platform\n    secrets:\n      deployment: aws:example/production/database/environment\n  - id: cache\n    name: Cache\n    type: redis\n    server: 203.0.113.10\n    secrets:\n      deployment: aws:example/production/cache/environment\n`;
  const parsed = parseDeploymentManifest(source).manifest;
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
  const parsed = parseDeploymentManifest(
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
      parseDeploymentManifest(
        manifest.replace(
          "    tls:\n      mode: cloudflare-dns",
          "    terminal:\n      enabled: true\n    tls:\n      mode: cloudflare-dns",
        ),
      ),
    ManifestValidationError,
  );
});

void test("normalizes managed backups and rejects unsafe declarations", () => {
  const parsed = parseDeploymentManifest(
    `${manifest}\nresources:\n  - id: database\n    name: Database\n    type: postgres\n    server: 203.0.113.10\n    backup:\n      s3:\n        bucket: example-production-backups\n        encryption: aws:kms\n        kmsKeyId: alias/towbar-backups\n`,
  ).manifest;
  const resource = parsed.resources?.[0];
  assert.ok(resource);
  assert.equal(resource.backup?.s3.encryption, "aws:kms");
  assert.equal(resource.backup?.s3.kmsKeyId, "alias/towbar-backups");

  assert.throws(
    () =>
      parseDeploymentManifest(
        `${manifest}\nresources:\n  - id: metrics\n    name: Metrics\n    type: image\n    image: prom/prometheus:v3.5.0\n    server: 203.0.113.10\n    backup:\n      s3:\n        bucket: example-production-backups\n`,
      ),
    ManifestValidationError,
  );
  assert.throws(
    () =>
      parseDeploymentManifest(
        `${manifest}\nresources:\n  - id: database\n    name: Database\n    type: postgres\n    server: 203.0.113.10\n    backup:\n      s3:\n        bucket: example-production-backups\n        encryption: aws:kms\n`,
      ),
    ManifestValidationError,
  );
});

void test("rejects mutable resource images and duplicate deployable ids", () => {
  const mutable = `${manifest}\nresources:\n  - id: metrics\n    name: Metrics\n    type: image\n    image: prom/prometheus:latest\n    server: 203.0.113.10\n`;
  assert.throws(
    () => parseDeploymentManifest(mutable),
    ManifestValidationError,
  );
  const duplicate = `${manifest}\nresources:\n  - id: towbar-web-app\n    name: Duplicate\n    type: redis\n    server: 203.0.113.10\n`;
  assert.throws(
    () => parseDeploymentManifest(duplicate),
    (error) => {
      assert.ok(error instanceof ManifestValidationError);
      assert.ok(
        error.issues.some((issue) =>
          issue.message.includes("Deployable id 'towbar-web-app'"),
        ),
      );
      return true;
    },
  );
});

void test("rejects unsafe or conflicting Resource connectivity declarations", () => {
  const resource = `\nresources:\n  - id: database\n    name: Database\n    type: postgres\n    server: 203.0.113.10\n    access:\n      sshTunnel:\n        hostPort: 15432\n    container:\n      network: towbar-platform\n      networkAlias: shared-database\n`;
  assert.doesNotThrow(() => parseDeploymentManifest(`${manifest}${resource}`));
  assert.throws(
    () =>
      parseDeploymentManifest(
        `${manifest}${resource.replace("      network: towbar-platform\n", "")}`,
      ),
    ManifestValidationError,
  );
  assert.throws(
    () =>
      parseDeploymentManifest(
        `${manifest}\nresources:\n  - id: metrics\n    name: Metrics\n    type: image\n    image: prom/prometheus:v3.5.0\n    server: 203.0.113.10\n    access:\n      sshTunnel:\n        hostPort: 15432\n`,
      ),
    ManifestValidationError,
  );
  assert.throws(
    () =>
      parseDeploymentManifest(
        `${manifest}${resource}  - id: analytics\n    name: Analytics\n    type: postgres\n    server: 203.0.113.10\n    access:\n      sshTunnel:\n        hostPort: 15432\n    container:\n      network: towbar-platform\n      networkAlias: analytics\n`,
      ),
    ManifestValidationError,
  );
  assert.throws(
    () =>
      parseDeploymentManifest(
        `${manifest}${resource}  - id: analytics\n    name: Analytics\n    type: postgres\n    server: 203.0.113.10\n    container:\n      network: towbar-platform\n      networkAlias: shared-database\n`,
      ),
    ManifestValidationError,
  );
});

void test("normalizes Resource image, command, health, volumes, and shared runtime secrets", () => {
  const parsed = parseDeploymentManifest(
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
  assert.deepEqual(resource.sharedSecrets.deployment, [
    "aws:example/production/shared/runtime",
  ]);
});

void test("defaults to main and rejects unsafe branch names", () => {
  const defaulted = parseDeploymentManifest(
    manifest.replace("source:\n  branch: release\n", ""),
  );
  assert.deepEqual(defaulted.manifest.source, { branch: "main" });
  assert.equal(defaulted.manifest.apps[0]?.sourceBranch, "main");
  assert.throws(
    () =>
      parseDeploymentManifest(
        manifest.replace("branch: release", "branch: ../main"),
      ),
    ManifestValidationError,
  );
});

void test("defaults the SSH host to the server IP", () => {
  const defaulted = parseDeploymentManifest(
    manifest.replace("      host: 10.0.0.10\n", ""),
  );
  assert.equal(defaulted.manifest.servers[0]?.ssh.host, "203.0.113.10");
});

void test("rejects duplicate YAML keys before reconciliation", () => {
  assert.throws(
    () =>
      parseDeploymentManifest("version: 1\nversion: 1\nservers: []\napps: []"),
    ManifestValidationError,
  );
});

void test("rejects duplicate app ids and domain claims", () => {
  const duplicate = manifest.replace(
    "    tls:\n      mode: cloudflare-dns",
    `    tls:\n      mode: cloudflare-dns\n  - id: towbar-web-app\n    name: Duplicate\n    server: 203.0.113.10\n    dockerfile: Dockerfile\n    container:\n      port: 3000\n    domains:\n      primary: app.towbar.dev`,
  );
  assert.throws(
    () => parseDeploymentManifest(duplicate),
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
  assert.throws(
    () => parseDeploymentManifest(invalid),
    ManifestValidationError,
  );
});

void test("rejects an unsafe Docker network name", () => {
  const invalid = manifest.replace(
    "network: towbar-platform",
    "network: --network=host",
  );
  assert.throws(
    () => parseDeploymentManifest(invalid),
    ManifestValidationError,
  );
});

void test("rejects invalid container resource limits", () => {
  const invalid = manifest.replace("memory: 1G", "memory: unlimited");
  assert.throws(
    () => parseDeploymentManifest(invalid),
    ManifestValidationError,
  );
});

void test("rejects the removed dependsOn manifest field", () => {
  const invalid = manifest.replace(
    "    context: .\n",
    "    context: .\n    dependsOn: [api]\n",
  );
  assert.throws(
    () => parseDeploymentManifest(invalid),
    (error) => {
      assert.ok(error instanceof ManifestValidationError);
      assert.ok(
        error.issues.some((issue) => issue.message.includes("dependsOn")),
      );
      return true;
    },
  );
});

void test("rejects Cloudflare TLS without a server token reference", () => {
  const invalid = manifest.replace(
    "    proxy:\n      cloudflare:\n        apiToken: aws:example/production/cloudflare/dns\n",
    "",
  );
  assert.throws(
    () => parseDeploymentManifest(invalid),
    (error) => {
      assert.ok(error instanceof ManifestValidationError);
      assert.ok(
        error.issues.some((issue) =>
          issue.message.includes("Cloudflare DNS TLS"),
        ),
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
