import assert from "node:assert/strict";
import test from "node:test";

import { belongsToSecretStageGroup } from "./secret-stage.js";

void test("keeps Preview build bindings out of Preview deployment", () => {
  assert.equal(
    belongsToSecretStageGroup("preview_build", "preview_deployment"),
    false,
  );
  assert.equal(
    belongsToSecretStageGroup("preview_deployment", "preview_deployment"),
    true,
  );
  assert.equal(
    belongsToSecretStageGroup("preview_pre_deploy", "preview_deployment"),
    true,
  );
});
