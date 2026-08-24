import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parseRuntimeInspectionOutput,
  runtimeInspectionScript,
} from "./runtime-inspection.js";

void describe("runtime inspection", () => {
  void it("parses bounded runtime and orphan results", () => {
    assert.deepEqual(
      parseRuntimeInspectionOutput(
        JSON.stringify({
          orphans: [
            {
              kind: "image",
              name: "towbar/deployable-old:release",
              reason: "Not retained",
            },
          ],
          runtime: [
            {
              deployableId: "10000000-0000-4000-8000-000000000001",
              driftReasons: [],
              driftStatus: "in_sync",
              healthStatus: "healthy",
              observedContainerName: "towbar-api-release",
              observedImage: "towbar/deployable-api:release",
              observedState: "running",
            },
          ],
        }),
      ).runtime[0]?.driftStatus,
      "in_sync",
    );
  });

  void it("rejects malformed worker output", () => {
    assert.throws(() =>
      parseRuntimeInspectionOutput(
        JSON.stringify({ orphans: [], runtime: [{ deployableId: "nope" }] }),
      ),
    );
  });

  void it("discovers only Source-labeled managed objects", () => {
    assert.match(runtimeInspectionScript, /label=towbar\.managed=true/);
    assert.match(runtimeInspectionScript, /towbar\.source/);
    assert.match(runtimeInspectionScript, /expected_containers/);
    assert.match(runtimeInspectionScript, /expected_images/);
    assert.doesNotMatch(runtimeInspectionScript, /system prune/);
  });

  void it("checks stable private aliases and loopback-only host ports", () => {
    assert.match(runtimeInspectionScript, /configured Docker network/);
    assert.match(runtimeInspectionScript, /configured Docker network alias/);
    assert.match(runtimeInspectionScript, /configured loopback host port/);
    assert.match(runtimeInspectionScript, /NetworkSettings/);
    assert.match(runtimeInspectionScript, /HostIp/);
    assert.match(runtimeInspectionScript, /127\.0\.0\.1/);
  });

  void it("runs manifest-defined HTTP and command health checks", () => {
    assert.match(runtimeInspectionScript, /health_type == "http"/);
    assert.match(runtimeInspectionScript, /urllib\.request\.urlopen/);
    assert.match(runtimeInspectionScript, /health_type == "command"/);
    assert.match(runtimeInspectionScript, /"docker", "exec"/);
    assert.match(runtimeInspectionScript, /timeout=timeout/);
  });
});
