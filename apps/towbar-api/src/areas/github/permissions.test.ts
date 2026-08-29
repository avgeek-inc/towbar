import assert from "node:assert/strict";
import test from "node:test";

import { githubPermissionReadiness } from "./permissions.js";

void test("reports Preview readiness only with every required permission", () => {
  assert.deepEqual(
    githubPermissionReadiness({
      checks: "write",
      contents: "read",
      deployments: "write",
      pull_requests: "write",
    }),
    {
      checks: "write",
      contents: "read",
      deployments: "write",
      planning: "ready",
      preview: "ready",
      pullRequests: "write",
    },
  );
  assert.equal(
    githubPermissionReadiness({
      contents: "read",
      deployments: "read",
      pull_requests: "write",
    }).preview,
    "missing",
  );
  assert.equal(
    githubPermissionReadiness({ contents: "read" }).preview,
    "missing",
  );
  assert.equal(
    githubPermissionReadiness({ checks: "read", contents: "read" }).planning,
    "missing",
  );
});
