import assert from "node:assert/strict";
import test from "node:test";

import {
  limitServerPreparationStepMessage,
  serverPreparationStepMessageMaxLength,
} from "./server-preparation.js";

void test("limits server preparation messages to the API contract", () => {
  const message = "x".repeat(serverPreparationStepMessageMaxLength + 1);

  assert.equal(
    limitServerPreparationStepMessage(message).length,
    serverPreparationStepMessageMaxLength,
  );
});
