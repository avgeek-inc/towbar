import assert from "node:assert/strict";
import test from "node:test";

import { applyEnvironmentSecretMutation } from "./service.js";

void test("applies write-only replacements and deletions without mutating the current bundle", () => {
  const current = {
    DELETE_ME: "old-delete-value",
    KEEP_ME: "old-keep-value",
    REPLACE_ME: "old-replace-value",
  };
  const next = applyEnvironmentSecretMutation(
    current,
    {
      delete: ["DELETE_ME"],
      set: { ADD_ME: "new-add-value", REPLACE_ME: "new-replace-value" },
    },
    "deployment",
  );
  assert.deepEqual(current, {
    DELETE_ME: "old-delete-value",
    KEEP_ME: "old-keep-value",
    REPLACE_ME: "old-replace-value",
  });
  assert.deepEqual(next, {
    ADD_ME: "new-add-value",
    KEEP_ME: "old-keep-value",
    REPLACE_ME: "new-replace-value",
  });
});

void test("allows an explicitly replaced value to be empty", () => {
  assert.deepEqual(
    applyEnvironmentSecretMutation(
      { TOKEN: "current" },
      { delete: [], set: { TOKEN: "" } },
      "build",
    ),
    { TOKEN: "" },
  );
});

void test("rejects invalid environment keys and non-string values", () => {
  assert.throws(
    () =>
      applyEnvironmentSecretMutation(
        {},
        { delete: [], set: { "INVALID-KEY": "value" } },
        "deployment",
      ),
    /not a valid environment key/u,
  );
});

void test("treats prototype-shaped environment keys as ordinary data", () => {
  const next = applyEnvironmentSecretMutation(
    {},
    {
      delete: [],
      set: Object.fromEntries([
        ["__proto__", "safe"],
        ["constructor", "also-safe"],
      ]),
    },
    "deployment",
  );
  assert.equal(Object.hasOwn(next, "__proto__"), true);
  assert.equal(next["__proto__"], "safe");
  assert.equal(next["constructor"], "also-safe");
  assert.equal(Object.getPrototypeOf({}).polluted, undefined);
});
