import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parseDeploymentManifest } from "./manifest.js";

void test("keeps the published starter manifest valid", () => {
  const example = readFileSync(
    new URL("../../../examples/deployment.yml", import.meta.url),
    "utf8",
  );

  assert.doesNotThrow(() => parseDeploymentManifest(example));
});
