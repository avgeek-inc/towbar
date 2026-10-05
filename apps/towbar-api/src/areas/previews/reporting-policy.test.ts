import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "../../http/errors.js";
import {
  previewReportDeliveryIsDue,
  previewReportingRetryAt,
} from "./reporting-policy.js";

const now = new Date("2026-10-05T12:00:00Z");
void test("preview reporting backs off, respects long rate limits, and slows access failures", () => {
  assert.equal(
    previewReportingRetryAt(new Error("offline"), 1, now).getTime() -
      now.getTime(),
    5 * 60_000,
  );
  assert.equal(
    previewReportingRetryAt(new Error("offline"), 2, now).getTime() -
      now.getTime(),
    10 * 60_000,
  );
  assert.equal(
    previewReportingRetryAt(new Error("offline"), 20, now).getTime() -
      now.getTime(),
    60 * 60_000,
  );
  assert.equal(
    previewReportingRetryAt(
      new HttpError(429, "GITHUB_RATE_LIMITED", "limited", {
        responseHeaders: { "retry-after": "7200" },
      }),
      1,
      now,
    ).getTime() - now.getTime(),
    2 * 60 * 60_000,
  );
  assert.equal(
    previewReportingRetryAt(
      new HttpError(403, "GITHUB_REQUEST_FAILED", "denied"),
      1,
      now,
    ).getTime() - now.getTime(),
    60 * 60_000,
  );
});
void test("recovers old failures and interrupted pending deliveries without repeating published work", () => {
  for (const status of ["failed", "pending", "published"] as const) {
    assert.equal(
      previewReportDeliveryIsDue(
        {
          status,
          nextAttemptAt: null,
          updatedAt: new Date(now.getTime() - 11 * 60_000),
        },
        now,
      ),
      status !== "published",
    );
    assert.equal(
      previewReportDeliveryIsDue(
        {
          status,
          nextAttemptAt: new Date(now.getTime() + 60_000),
          updatedAt: now,
        },
        now,
      ),
      false,
    );
  }
  assert.equal(
    previewReportDeliveryIsDue(
      { status: "pending", nextAttemptAt: null, updatedAt: now },
      now,
    ),
    false,
  );
});
