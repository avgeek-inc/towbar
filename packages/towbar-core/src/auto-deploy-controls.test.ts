import assert from "node:assert/strict";
import test from "node:test";

import { evaluateAutoDeployPause } from "./auto-deploy-controls.js";

void test("a Source pause takes precedence over a deployable pause", () => {
  assert.deepEqual(
    evaluateAutoDeployPause({ deployablePaused: true, sourcePaused: true }),
    { paused: true, scope: "source" },
  );
});

void test("a deployable pause affects only that deployable", () => {
  assert.deepEqual(
    evaluateAutoDeployPause({ deployablePaused: true, sourcePaused: false }),
    { paused: true, scope: "deployable" },
  );
  assert.deepEqual(
    evaluateAutoDeployPause({ deployablePaused: false, sourcePaused: false }),
    { paused: false, scope: null },
  );
});
