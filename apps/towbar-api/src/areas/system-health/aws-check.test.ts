import assert from "node:assert/strict";
import test from "node:test";

import { awsHealthCheck } from "./aws-check.js";

const now = Date.parse("2026-09-05T08:00:00Z");
const credential = {
  lastVerifiedAt: new Date(now),
  region: "ap-south-1",
  status: "verified" as const,
  verificationMessage: "AWS identity verified",
};

void test("AWS health requires a recent successful verification", () => {
  assert.equal(awsHealthCheck(credential, now).status, "healthy");
  assert.equal(
    awsHealthCheck({ ...credential, lastVerifiedAt: null }, now).status,
    "unknown",
  );
  assert.equal(
    awsHealthCheck({ ...credential, status: "unverified" }, now).status,
    "unknown",
  );
  const stale = awsHealthCheck(credential, now + 25 * 60 * 60_000);
  assert.equal(stale.status, "attention");
  assert.match(stale.description, /stale/);
});

void test("failed AWS checks remain critical and link to the integration", () => {
  const check = awsHealthCheck({ ...credential, status: "failed" }, now);
  assert.equal(check.status, "critical");
  assert.equal(check.remediationHref, "/manage/integrations?integration=aws");
  assert.equal(check.checkedAt, credential.lastVerifiedAt.toISOString());
  assert.equal(awsHealthCheck(credential, now).remediationHref, null);
});
