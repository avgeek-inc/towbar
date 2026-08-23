import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { scopeDeploymentIdempotencyKey } from "./idempotency.js";

void describe("deployment idempotency scope", () => {
  const request = { appId: "app-1", idempotencyKey: "browser-request-1" };

  void it("is stable for the same logical request", () => {
    assert.equal(
      scopeDeploymentIdempotencyKey("deploy", request),
      scopeDeploymentIdempotencyKey("deploy", request),
    );
  });

  void it("does not replay a deploy as a rollback", () => {
    assert.notEqual(
      scopeDeploymentIdempotencyKey("deploy", request),
      scopeDeploymentIdempotencyKey("rollback", request),
    );
  });

  void it("distinguishes app and release targets", () => {
    const first = scopeDeploymentIdempotencyKey("rollback", {
      ...request,
      releaseId: "release-1",
    });
    assert.notEqual(
      first,
      scopeDeploymentIdempotencyKey("rollback", {
        ...request,
        appId: "app-2",
        releaseId: "release-1",
      }),
    );
    assert.notEqual(
      first,
      scopeDeploymentIdempotencyKey("rollback", {
        ...request,
        releaseId: "release-2",
      }),
    );
  });
});
