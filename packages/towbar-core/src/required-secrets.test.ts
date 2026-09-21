import assert from "node:assert/strict";
import test from "node:test";
import {
  reconcileDeclaredSecretValues,
  requiredKeysForStage,
} from "./required-secrets.js";

void test("reconciliation preserves values, empty strings and references but removes undeclared keys", () => {
  const result = reconcileDeclaredSecretValues(
    ["NEW", "EMPTY", "REFERENCE", "EXISTING"],
    {
      EMPTY: "",
      REFERENCE: "$shared.TOKEN",
      EXISTING: "saved",
      REMOVED: "old",
    },
  );
  assert.deepEqual(
    { ...result.values },
    { EMPTY: "", REFERENCE: "$shared.TOKEN", EXISTING: "saved" },
  );
  assert.deepEqual(result.missingKeys, ["NEW"]);
  assert.deepEqual(result.removedKeys, ["REMOVED"]);
  assert.deepEqual(result.keys, ["EMPTY", "EXISTING", "NEW", "REFERENCE"]);
});

void test("renaming does not copy values and an empty declaration removes all values", () => {
  assert.deepEqual(
    reconcileDeclaredSecretValues(["RENAMED"], { ORIGINAL: "secret" })
      .missingKeys,
    ["RENAMED"],
  );
  assert.deepEqual(
    Object.keys(
      reconcileDeclaredSecretValues([], { ORIGINAL: "secret" }).values,
    ),
    [],
  );
});

void test("runtime declaration maps to the existing execution stage", () => {
  assert.deepEqual(
    requiredKeysForStage(
      { build: [], runtime: ["DATABASE_URL"], preDeploy: [], postDeploy: [] },
      "deployment",
    ),
    ["DATABASE_URL"],
  );
});
