import assert from "node:assert/strict";
import { test } from "node:test";

import {
  resourceOperationTypeSchema,
  resourceOperationTypes,
} from "./resource-operations.js";

void test("admits restore and rollback-volume cleanup as managed operations", () => {
  assert.equal(resourceOperationTypes.includes("restore"), true);
  assert.equal(resourceOperationTypeSchema.safeParse("restore").success, true);
  assert.equal(
    resourceOperationTypeSchema.safeParse("restore_cleanup").success,
    true,
  );
});
