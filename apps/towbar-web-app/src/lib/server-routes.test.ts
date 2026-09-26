import assert from "node:assert/strict";
import test from "node:test";

import { isServerSectionPath } from "./server-routes";

test("server navigation routes include valid settings pages", () => {
  assert.equal(isServerSectionPath(["settings", "credentials"]), true);
  assert.equal(isServerSectionPath(["settings", "configuration"]), true);
  assert.equal(isServerSectionPath(["settings", "unknown"]), false);
  assert.equal(isServerSectionPath(["maintenance"]), false);
  assert.equal(isServerSectionPath([]), false);
});
