import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { serverCheckIdsToPrune } from "./check-retention.js";

function check(
  id: string,
  status: "failed" | "queued" | "running" | "succeeded" = "succeeded",
) {
  return { id, status };
}

void describe("serverCheckIdsToPrune", () => {
  void it("keeps the newest checks within the retention limit", () => {
    assert.deepEqual(
      serverCheckIdsToPrune([check("newest"), check("older")], 2),
      [],
    );
  });

  void it("prunes terminal checks beyond the retention limit", () => {
    assert.deepEqual(
      serverCheckIdsToPrune(
        [check("newest"), check("older"), check("oldest", "failed")],
        1,
      ),
      ["older", "oldest"],
    );
  });

  void it("preserves active checks even when they are older than the limit", () => {
    assert.deepEqual(
      serverCheckIdsToPrune(
        [
          check("newest"),
          check("queued", "queued"),
          check("running", "running"),
          check("finished"),
        ],
        1,
      ),
      ["finished"],
    );
  });
});
