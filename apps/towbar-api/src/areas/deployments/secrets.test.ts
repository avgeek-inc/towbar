import assert from "node:assert/strict";
import test from "node:test";

import { mergeEnvironmentSecretBundles } from "./service.js";

void test("merges shared bundles and lets the deployable override shared keys", () => {
  assert.deepEqual(
    mergeEnvironmentSecretBundles(
      [{ PACKAGE_REGISTRY_TOKEN: "shared", SHARED_ONLY: "one" }],
      { PACKAGE_REGISTRY_TOKEN: "app", APP_ONLY: "two" },
    ),
    {
      APP_ONLY: "two",
      PACKAGE_REGISTRY_TOKEN: "app",
      SHARED_ONLY: "one",
    },
  );
});

void test("rejects duplicate keys between shared bundles", () => {
  assert.throws(
    () =>
      mergeEnvironmentSecretBundles([
        { PACKAGE_REGISTRY_TOKEN: "first" },
        { PACKAGE_REGISTRY_TOKEN: "second" },
      ]),
    /duplicate environment key 'PACKAGE_REGISTRY_TOKEN'/u,
  );
});
