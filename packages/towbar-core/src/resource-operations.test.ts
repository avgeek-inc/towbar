import assert from "node:assert/strict";
import { test } from "node:test";

import {
  resourceOperationTypeSchema,
  resourceOperationTypes,
} from "./resource-operations.js";

void test("does not admit Towbar-managed database restores", () => {
  assert.equal(resourceOperationTypes.includes("restore" as never), false);
  assert.equal(resourceOperationTypeSchema.safeParse("restore").success, false);
});
