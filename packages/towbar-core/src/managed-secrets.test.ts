import assert from "node:assert/strict";
import test from "node:test";
import {
  applySecretMutation,
  mergeSecretValues,
  secretMutationSchema,
} from "./managed-secrets.js";
import { parseDeploymentManifest } from "./manifest.js";

void test("write-only mutations preserve unspecified keys, allow empty values, and restore inheritance", () => {
  const shared = { TOKEN: "shared", COMMON: "common" };
  const local = { TOKEN: "local", REMOVE: "old" };
  const changed = applySecretMutation(local, {
    set: { EMPTY: "" },
    delete: ["TOKEN", "REMOVE"],
  });
  assert.deepEqual(mergeSecretValues(shared, changed), {
    TOKEN: "shared",
    COMMON: "common",
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
    "version: 1\nservers:\n  - ip: 192.0.2.10\n    ssh:\n      username: deploy\napps:\n  - id: demo\n    name: Demo\n    server: 192.0.2.10\n    dockerfile: Dockerfile\n    context: .\n    container:\n      port: 3000\n";
  assert.doesNotThrow(() => parseDeploymentManifest(base));
  for (const manifest of [
    `${base}secrets:\n  build: [aws:old]\n`,
    base.replace("    ssh:", "    secrets:\n      login: aws:old\n    ssh:"),
    `${base}    secrets:\n      build: aws:old\n`,
    `${base}    hooks:\n      preDeploy:\n        command: [node, migrate.js]\n        secrets: aws:old\n`,
    `${base}    preview:\n      enabled: true\n      domain: preview.example.com\n      secrets: {}\n`,
  ])
    assert.throws(() => parseDeploymentManifest(manifest));
});
