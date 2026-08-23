import assert from "node:assert/strict";
import test from "node:test";

import { mergeEnvironmentSecretBundles } from "./service.js";

void test("merges shared bundles and lets the deployable override shared keys", () => {
  assert.deepEqual(
    mergeEnvironmentSecretBundles(
      [{ HUGEICONS_LICENSE_KEY: "shared", SHARED_ONLY: "one" }],
      { HUGEICONS_LICENSE_KEY: "app", APP_ONLY: "two" },
    ),
    {
      APP_ONLY: "two",
      HUGEICONS_LICENSE_KEY: "app",
      SHARED_ONLY: "one",
    },
  );
});

void test("rejects duplicate keys between shared bundles", () => {
  assert.throws(
    () =>
      mergeEnvironmentSecretBundles([
        { HEROUI_PRO_LICENSE: "first" },
        { HEROUI_PRO_LICENSE: "second" },
      ]),
    /duplicate environment key 'HEROUI_PRO_LICENSE'/u,
  );
});
