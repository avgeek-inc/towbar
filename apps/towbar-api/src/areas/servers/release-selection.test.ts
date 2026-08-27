import assert from "node:assert/strict";
import test from "node:test";

import {
  selectCurrentContainerNames,
  selectCurrentProductionReleaseByDeployable,
} from "./release-selection.js";

void test("Preview releases never replace production runtime expectations", () => {
  const releases = [
    {
      appId: "website",
      containerName: "website-production",
      environment: "production" as const,
      status: "current" as const,
    },
    {
      appId: "website",
      containerName: "website-preview-feature",
      environment: "preview" as const,
      status: "current" as const,
    },
  ];
  const selected = selectCurrentProductionReleaseByDeployable(releases);

  assert.equal(selected.get("website")?.containerName, "website-production");
  assert.deepEqual(selectCurrentContainerNames(releases), [
    "website-production",
    "website-preview-feature",
  ]);
});
