import assert from "node:assert/strict";
import test from "node:test";
import type { ServerPreparation } from "@workspace/towbar-web-client";
import {
  serverPreparationIndicator,
  shouldShowServerPreparation,
} from "./server-preparation-visibility";

const preparation: ServerPreparation = {
  createdAt: "2026-09-16T09:58:00.000Z",
  errorCode: null,
  errorMessage: null,
  finishedAt: null,
  id: "preparation-1",
  result: null,
  startedAt: null,
  status: "queued",
  steps: [],
};

void test("overview prompts for unprepared servers without an active attempt", () => {
  assert.equal(
    shouldShowServerPreparation({
      setupStatus: "pending",
      latestPreparation: undefined,
    }),
    true,
  );
  // A changed configuration needs preparation again, even with older history.
  assert.equal(
    shouldShowServerPreparation({
      setupStatus: "pending",
      latestPreparation: { ...preparation, status: "succeeded" },
    }),
    true,
  );
  assert.equal(
    shouldShowServerPreparation({
      setupStatus: "failed",
      latestPreparation: { ...preparation, status: "failed" },
    }),
    true,
  );
  for (const status of ["queued", "running", "succeeded"] as const) {
    assert.equal(
      shouldShowServerPreparation({
        setupStatus: status === "succeeded" ? "ready" : "preparing",
        latestPreparation: { ...preparation, status },
      }),
      false,
    );
  }
  assert.equal(
    shouldShowServerPreparation({
      setupStatus: "ready",
      latestPreparation: undefined,
    }),
    false,
  );
  assert.equal(
    shouldShowServerPreparation({
      setupStatus: "pending",
      latestPreparation: preparation,
    }),
    false,
  );
  assert.equal(
    shouldShowServerPreparation({
      setupStatus: "failed",
      latestPreparation: preparation,
    }),
    false,
  );
});

void test("sidebar warns for pending or failed setup and spins while queued or running", () => {
  for (const setupStatus of ["pending", "failed"] as const) {
    assert.equal(
      serverPreparationIndicator({ setupStatus, latestPreparation: undefined }),
      "warning",
    );
  }
  for (const status of ["queued", "running"] as const) {
    assert.equal(
      serverPreparationIndicator({
        setupStatus: "pending",
        latestPreparation: { ...preparation, status },
      }),
      "busy",
    );
  }
  assert.equal(
    serverPreparationIndicator({
      setupStatus: "preparing",
      latestPreparation: undefined,
    }),
    "busy",
  );
  assert.equal(
    serverPreparationIndicator({
      setupStatus: "ready",
      latestPreparation: { ...preparation, status: "succeeded" },
    }),
    undefined,
  );
});
