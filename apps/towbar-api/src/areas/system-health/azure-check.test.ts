import assert from "node:assert/strict";
import test from "node:test";

import { azureHealthCheck } from "./azure-check.js";

const now = Date.parse("2026-09-05T08:00:00Z");
const credential = {
  clientId: "11111111-1111-4111-8111-111111111111",
  lastVerifiedAt: new Date(now),
  status: "verified" as const,
  tenantId: "22222222-2222-4222-8222-222222222222",
  verificationMessage: "Azure tenant verified",
};

void test("Azure health requires a recent successful verification", () => {
  assert.equal(azureHealthCheck(credential, now).status, "healthy");
  assert.equal(
    azureHealthCheck({ ...credential, lastVerifiedAt: null }, now).status,
    "unknown",
  );
  assert.equal(
    azureHealthCheck({ ...credential, status: "unverified" }, now).status,
    "unknown",
  );
  const stale = azureHealthCheck(credential, now + 25 * 60 * 60_000);
  assert.equal(stale.status, "attention");
  assert.match(stale.description, /stale/);
});

void test("failed Azure checks remain critical and link to the integration", () => {
  const check = azureHealthCheck({ ...credential, status: "failed" }, now);
  assert.equal(check.status, "critical");
  assert.equal(check.remediationHref, "/manage/integrations?integration=azure");
  assert.equal(check.checkedAt, credential.lastVerifiedAt.toISOString());
  assert.equal(azureHealthCheck(credential, now).remediationHref, null);
});
