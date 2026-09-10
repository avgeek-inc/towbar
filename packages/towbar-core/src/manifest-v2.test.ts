import assert from "node:assert/strict";
import test from "node:test";
import { stringify } from "yaml";
import {
  entityFileKind,
  parseRepositoryManifest,
  resolveRepositoryEnvironment,
} from "./manifest-v2.js";

const root = stringify({
  version: 2,
  environments: {
    production: {},
    staging: { previews: { enabled: true } },
  },
});
const app = {
  id: "website",
  name: "Website",
  dockerfile: "Dockerfile",
  autoDeploy: true,
  container: { port: 3000, resources: { cpus: 1, memory: "512m" } },
  secrets: { runtime: ["DATABASE_URL", "SESSION_SECRET"] },
  environments: {
    production: {
      server: "production-server",
      domains: { primary: "app.example.com" },
    },
    staging: {
      server: "staging-server",
      container: { resources: { cpus: 0.5 } },
      domains: { primary: "staging.example.com" },
    },
  },
  tls: { mode: "direct" },
  preview: { enabled: true, domain: "preview.example.com", ttlHours: 72 },
};
function resolve(
  entity: unknown = app,
  environment = "staging",
  resource?: unknown,
) {
  return resolveRepositoryEnvironment({
    root,
    environment,
    branch: environment === "staging" ? "develop" : "main",
    files: [
      { path: ".towbar/apps/website.app.yml", content: stringify(entity) },
      ...(resource
        ? [
            {
              path: ".towbar/resources/database.resource.yml",
              content: stringify(resource),
            },
          ]
        : []),
    ],
  });
}

void test("root rejects Git branch mappings and configurable entity directories", () => {
  assert.throws(() =>
    parseRepositoryManifest(
      "version: 2\nenvironments:\n  production:\n    branch: main",
    ),
  );
  assert.throws(() => parseRepositoryManifest(`${root}\nentities: .towbar`));
  assert.throws(() =>
    parseRepositoryManifest("version: 1\nenvironments:\n  production: {}"),
  );
});

void test("resolves only selected environment with deep object overrides and required secrets", () => {
  const { manifest } = resolve();
  assert.equal(manifest.version, 2);
  assert.equal(manifest.apps[0]?.server, "staging-server");
  assert.equal(manifest.apps[0]?.sourceBranch, "develop");
  assert.deepEqual(manifest.apps[0]?.container.resources, {
    cpus: 0.5,
    memory: "512m",
  });
  assert.deepEqual(manifest.requiredSecrets["app:website"]?.runtime, [
    "DATABASE_URL",
    "SESSION_SECRET",
  ]);
  assert.equal(manifest.apps[0]?.preview?.enabled, true);
  assert.equal(resolve(app, "production").manifest.apps[0]?.preview, undefined);
});

void test("production-only edits do not change staging digest", () => {
  const changed = structuredClone(app);
  changed.environments.production.domains.primary = "other.example.com";
  assert.equal(resolve().digest, resolve(changed).digest);
  assert.notEqual(
    resolve(app, "production").digest,
    resolve(changed, "production").digest,
  );
});

void test("replaces lists instead of concatenating them", () => {
  const entity = {
    ...app,
    domains: {
      primary: "base.example.com",
      redirects: [{ host: "old.example.com" }],
    },
    environments: {
      staging: { server: "staging-server", domains: { redirects: [] } },
    },
  };
  assert.deepEqual(resolve(entity).manifest.apps[0]?.domains?.redirects, []);
});

void test("explicit environment membership controls instances", () => {
  const entity = {
    ...app,
    environments: { production: app.environments.production },
  };
  assert.equal(resolve(entity).manifest.apps.length, 0);
  assert.deepEqual(Object.keys(resolve(entity).manifest.requiredSecrets), []);
});

void test("logical app and resource may share an id", () => {
  const result = resolve(app, "staging", {
    id: "website",
    name: "Database",
    type: "postgres",
    environments: { staging: { server: "staging-server" } },
  });
  assert.equal(result.manifest.apps[0]?.id, result.manifest.resources?.[0]?.id);
});

void test("rejects unknown environments and identity overrides", () => {
  assert.throws(
    () =>
      resolve({ ...app, environments: { typo: { server: "staging-server" } } }),
    /invalid/,
  );
  assert.throws(() =>
    resolve({
      ...app,
      environments: { staging: { id: "other", server: "staging-server" } },
    }),
  );
  assert.throws(() => resolve(app, "missing"));
});

void test("rejects duplicate keys, aliases, invalid secret declarations and IP server references", () => {
  assert.throws(() =>
    parseRepositoryManifest("version: 2\nversion: 2\nenvironments: {}"),
  );
  assert.throws(() =>
    parseRepositoryManifest(
      "version: 2\nenvironments:\n  production: &prod {}\n  staging: *prod",
    ),
  );
  assert.throws(() => resolve({ ...app, secrets: { runtime: ["A", "A"] } }));
  assert.throws(() => resolve({ ...app, secrets: { runtime: ["__proto__"] } }));
  assert.throws(() =>
    resolve({ ...app, environments: { staging: { server: "192.0.2.1" } } }),
  );
});

void test("discovers reserved paths recursively and rejects escaping paths", () => {
  assert.equal(entityFileKind(".towbar/apps/team/website.app.yml"), "app");
  assert.equal(entityFileKind(".towbar/resources/db.resource.yml"), "resource");
  assert.equal(entityFileKind(".towbar/apps/db.resource.yml"), undefined);
  assert.throws(() => entityFileKind(".towbar/apps/../website.app.yml"));
});

void test("same-kind duplicate ids fail even in different files", () => {
  assert.throws(() =>
    resolveRepositoryEnvironment({
      root,
      environment: "staging",
      branch: "develop",
      files: [
        { path: ".towbar/apps/a.app.yml", content: stringify(app) },
        { path: ".towbar/apps/b.app.yml", content: stringify(app) },
      ],
    }),
  );
});

void test("renaming an entity file preserves resolved identity and digest", () => {
  const renamed = resolveRepositoryEnvironment({
    root,
    environment: "staging",
    branch: "develop",
    files: [{ path: ".towbar/apps/renamed.app.yml", content: stringify(app) }],
  });
  assert.equal(renamed.digest, resolve().digest);
});
