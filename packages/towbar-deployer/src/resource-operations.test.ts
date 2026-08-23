import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resourceOperationScripts } from "./resource-operations.js";

void describe("Resource operation scripts", () => {
  void it("uses database-native archives and validates them before upload", () => {
    assert.match(resourceOperationScripts.createBackup, /pg_dump/);
    assert.match(resourceOperationScripts.createBackup, /pg_restore --list/);
    assert.match(resourceOperationScripts.createBackup, /redis-cli/);
    assert.match(resourceOperationScripts.createBackup, /redis-check-rdb/);
    assert.match(resourceOperationScripts.createBackup, /test -s/);
    assert.match(resourceOperationScripts.createBackup, /stat -c %s/);
  });

  void it("binds backup and runtime operations to the retained deployable", () => {
    for (const script of [
      resourceOperationScripts.createBackup,
      resourceOperationScripts.containerOperation,
    ]) {
      assert.match(script, /towbar\.managed/);
      assert.match(script, /towbar\.deployable/);
      assert.match(script, /towbar\.app/);
    }
  });

  void it("rechecks Source ownership and expected release state before cleanup", () => {
    assert.match(resourceOperationScripts.cleanupOrphans, /towbar\.source/);
    assert.match(resourceOperationScripts.cleanupOrphans, /towbar\.managed/);
    assert.match(resourceOperationScripts.cleanupOrphans, /containerNames/);
    assert.match(resourceOperationScripts.cleanupOrphans, /deployableIds/);
    assert.match(resourceOperationScripts.cleanupOrphans, /imageTags/);
    assert.doesNotMatch(
      resourceOperationScripts.cleanupOrphans,
      /system prune/,
    );
  });
});
