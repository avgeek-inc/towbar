import assert from "node:assert/strict";
import test from "node:test";

import { gcpHealthCheck } from "./gcp-check.js";

const now = Date.parse("2026-09-05T08:00:00Z");
const credential = {
  clientEmail: "towbar-backups@test-project.iam.gserviceaccount.com",
  lastVerifiedAt: new Date(now),
  projectId: "test-project",
  status: "verified" as const,
  verificationMessage: "GCP project test-project verified",
};

void test("Google Cloud health requires a recent successful verification", () => {
  assert.equal(gcpHealthCheck(credential, now).status, "healthy");
  assert.equal(
    gcpHealthCheck({ ...credential, lastVerifiedAt: null }, now).status,
    "unknown",
  );
  assert.equal(
    gcpHealthCheck({ ...credential, status: "unverified" }, now).status,
    "unknown",
  );
  const stale = gcpHealthCheck(credential, now + 25 * 60 * 60_000);
  assert.equal(stale.status, "attention");
  assert.match(stale.description, /stale/);
});

void test("failed Google Cloud checks remain critical and link to the integration", () => {
  const check = gcpHealthCheck({ ...credential, status: "failed" }, now);
  assert.equal(check.status, "critical");
  assert.equal(check.remediationHref, "/manage/integrations?integration=gcp");
  assert.equal(check.checkedAt, credential.lastVerifiedAt.toISOString());
  assert.equal(gcpHealthCheck(credential, now).remediationHref, null);
});
