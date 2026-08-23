import assert from "node:assert/strict";
import test from "node:test";

import { findUnavailableAppDependencies } from "./dependencies.js";

void test("requires every dependency to have its desired deployment digest", () => {
  assert.deepEqual(
    findUnavailableAppDependencies({
      dependencyIds: ["api", "sso", "missing", "archived"],
      releases: [
        {
          archivedAt: null,
          currentDeploymentDigest: "api-v1",
          desiredDeploymentDigest: "api-v1",
          manifestId: "api",
        },
        {
          archivedAt: null,
          currentDeploymentDigest: "sso-v1",
          desiredDeploymentDigest: "sso-v2",
          manifestId: "sso",
        },
        {
          archivedAt: new Date(),
          currentDeploymentDigest: "archived-v1",
          desiredDeploymentDigest: "archived-v1",
          manifestId: "archived",
        },
      ],
    }),
    ["sso", "missing", "archived"],
  );
});

void test("accepts unchanged dependencies across Source commits", () => {
  assert.deepEqual(
    findUnavailableAppDependencies({
      dependencyIds: ["api", "database", "cache"],
      releases: [
        {
          archivedAt: null,
          currentDeploymentDigest: "api-v1",
          desiredDeploymentDigest: "api-v1",
          manifestId: "api",
        },
        {
          archivedAt: null,
          currentDeploymentDigest: "database-v1",
          desiredDeploymentDigest: "database-v1",
          manifestId: "database",
        },
        {
          archivedAt: null,
          currentDeploymentDigest: "cache-v1",
          desiredDeploymentDigest: "cache-v2",
          manifestId: "cache",
        },
      ],
    }),
    ["cache"],
  );
});
