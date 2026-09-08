import assert from "node:assert/strict";
import test from "node:test";
import {
  applySecretMutation,
  resolveSecretReferences,
  secretMutationSchema,
  secretReferenceDependencies,
  validateSecretReferences,
} from "./managed-secrets.js";
import { parseDeploymentManifest } from "./manifest.js";

void test("write-only mutations preserve unspecified keys, allow empty values, and remove keys without restoring inheritance", () => {
  const shared = { TOKEN: "shared", COMMON: "common" };
  const local = { TOKEN: "local", REMOVE: "old" };
  const changed = applySecretMutation(local, {
    set: { EMPTY: "" },
    delete: ["TOKEN", "REMOVE"],
  });
  assert.deepEqual(resolveSecretReferences(changed, shared), {
    EMPTY: "",
  });
  assert.equal(local.TOKEN, "local");
});
void test("rejects ambiguous mutations, invalid names, null bytes and missing revisions", () => {
  for (const input of [
    { set: { TOKEN: "value" } },
    { expectedRevision: null, set: { "bad-name": "value" } },
    { expectedRevision: null, set: { TOKEN: "value\0" } },
    { expectedRevision: null, set: { TOKEN: "value" }, delete: ["TOKEN"] },
    { expectedRevision: null, delete: ["TOKEN", "TOKEN"] },
  ])
    assert.equal(secretMutationSchema.safeParse(input).success, false);
});
void test("prototype-shaped keys cannot alter object prototypes or silently disappear", () => {
  assert.equal(
    secretMutationSchema.safeParse(
      JSON.parse(
        '{"expectedRevision":null,"set":{"__proto__":"safe","TOKEN":"safe"}}',
      ),
    ).success,
    false,
  );
  const result = applySecretMutation(
    {},
    {
      set: JSON.parse('{"__proto__":"safe","constructor":"safe"}') as Record<
        string,
        string
      >,
      delete: [],
    },
  );
  assert.equal(Object.hasOwn(result, "__proto__"), true);
  assert.equal(result["__proto__"], "safe");
});
void test("manifests reject secret assignments at every former scope", () => {
  const base =
    "version: 1\napps:\n  - id: demo\n    name: Demo\n    server: 192.0.2.10\n    dockerfile: Dockerfile\n    context: .\n    container:\n      port: 3000\n";
  assert.doesNotThrow(() => parseDeploymentManifest(base));
  for (const manifest of [
    `${base}secrets:\n  build: [aws:old]\n`,
    `${base}servers:\n  - ip: 192.0.2.10\n    ssh:\n      username: deploy\n    secrets:\n      login: aws:old\n`,
    `${base}    secrets:\n      build: aws:old\n`,
    `${base}    hooks:\n      preDeploy:\n        command: [node, migrate.js]\n        secrets: aws:old\n`,
    `${base}    preview:\n      enabled: true\n      domain: preview.example.com\n      secrets: {}\n`,
  ])
    assert.throws(() => parseDeploymentManifest(manifest));
});

void test("only explicit references add shared values, including embedded and chained references", () => {
  const globals = { TOKEN: "global$&", EMPTY: "", UNUSED: "hidden" };
  const source = {
    TOKEN: "source",
    CHAIN: "Bearer {{globals.TOKEN}}",
    BROKEN: "{{source.MISSING}}",
  };
  assert.deepEqual(resolveSecretReferences({}, globals, source), {});
  assert.deepEqual(
    resolveSecretReferences(
      {
        TOKEN: "local",
        AUTH: "{{source.CHAIN}}",
        EMPTY: "{{globals.EMPTY}}",
        URL: "token={{source.TOKEN}}",
      },
      globals,
      source,
    ),
    { TOKEN: "local", AUTH: "Bearer global$&", EMPTY: "", URL: "token=source" },
  );
  assert.throws(
    () =>
      resolveSecretReferences(
        { SECRET: "{{globals.MISSING}}" },
        globals,
        source,
      ),
    /unavailable globals reference/,
  );
  assert.throws(
    () =>
      resolveSecretReferences({ SECRET: "{{source.BROKEN}}" }, globals, source),
    /cannot reference source at this scope/,
  );
  assert.throws(
    () => resolveSecretReferences({ SECRET: "{{globals.toString}}" }, globals),
    /unavailable globals reference/,
  );
  assert.deepEqual(
    secretReferenceDependencies({ AUTH: "{{source.CHAIN}}" }, source),
    { global: true, shared: true },
  );
  assert.deepEqual(secretReferenceDependencies({ TOKEN: "literal" }, source), {
    global: false,
    shared: false,
  });
});
void test("reference syntax respects scope and errors do not contain values", () => {
  assert.throws(
    () =>
      resolveSecretReferences(
        { TOKEN: "{{source.LEGACY}}" },
        {},
        { LEGACY: "{{globals.BAD" },
      ),
    /invalid reference/,
  );
  assert.doesNotThrow(() =>
    validateSecretReferences({ TOKEN: "{{globals.KEY}}" }, "source"),
  );
  for (const [scope, value] of [
    ["workspace", "{{globals.KEY}}"],
    ["source", "{{source.KEY}}"],
    ["app", "{{globals.bad-name}}"],
    ["app", "{{source.SECRET"],
  ] as const)
    assert.throws(
      () => validateSecretReferences({ TOKEN: value }, scope),
      /Secret TOKEN/,
    );
  assert.throws(
    () =>
      resolveSecretReferences(
        { AUTH: "{{globals.KEY}}{{globals.KEY}}" },
        { KEY: "x".repeat(40_000) },
      ),
    /size limit/,
  );
});
