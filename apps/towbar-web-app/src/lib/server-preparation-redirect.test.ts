import assert from "node:assert/strict";
import test from "node:test";
import type {
  ServerCheck,
  ServerPreparation,
} from "@workspace/towbar-web-client";
import { hasScheduledPostSetupCheck } from "./server-preparation-redirect";

const preparation = {
  createdAt: "2026-09-24T08:00:00.000Z",
  status: "succeeded",
} as ServerPreparation;
const check = {
  createdAt: "2026-09-24T08:01:00.000Z",
  errorCode: null,
  status: "queued",
} as ServerCheck;

test("redirect waits for the check scheduled after successful setup", () => {
  assert.equal(hasScheduledPostSetupCheck(preparation, null), false);
  assert.equal(
    hasScheduledPostSetupCheck({ ...preparation, status: "running" }, check),
    false,
  );
  assert.equal(
    hasScheduledPostSetupCheck(preparation, {
      ...check,
      createdAt: preparation.createdAt,
    }),
    false,
  );
  assert.equal(hasScheduledPostSetupCheck(preparation, check), true);
  assert.equal(
    hasScheduledPostSetupCheck(preparation, {
      ...check,
      errorCode: "TEMPORAL_UNAVAILABLE",
      status: "failed",
    }),
    false,
  );
});
