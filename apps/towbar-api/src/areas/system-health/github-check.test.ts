import assert from "node:assert/strict";
import test from "node:test";

import { githubHealthCheck } from "./github-check.js";

const now = Date.parse("2026-09-05T08:00:00Z");
const input = {
  configured: true,
  connection: { accountLogin: "example-inc", suspendedAt: null },
  signal: {
    checkedAt: new Date(now),
    message: "GitHub confirmed access to example-inc.",
    status: "healthy",
  },
};

void test("GitHub success stays healthy for 24 hours, then explains why it needs attention", () => {
  const fresh = githubHealthCheck(input, now + 24 * 60 * 60_000);
  assert.equal(fresh.status, "healthy");
  assert.equal(fresh.description, input.signal.message);
  assert.equal(fresh.remediationHref, null);
  const stale = githubHealthCheck(input, now + 24 * 60 * 60_000 + 1);
  assert.equal(stale.status, "attention");
  assert.match(
    stale.description,
    /^The last GitHub access check is more than 24 hours old/,
  );
  assert.match(stale.description, /Run checks to verify access to example-inc/);
  assert.match(stale.description, /Last result: GitHub confirmed access/);
  assert.equal(stale.checkedAt, input.signal.checkedAt.toISOString());
});

void test("missing configuration overrides a previous successful check", () => {
  const check = githubHealthCheck({ ...input, configured: false }, now);
  assert.equal(check.status, "critical");
  assert.match(check.description, /Complete the GitHub App environment/);
  assert.doesNotMatch(check.description, /confirmed access/);
});

void test("disconnected and suspended installations override previous success", () => {
  const missing = githubHealthCheck({ ...input, connection: undefined }, now);
  assert.equal(missing.status, "attention");
  assert.match(missing.description, /Install the GitHub App/);
  const suspended = githubHealthCheck(
    {
      ...input,
      connection: { ...input.connection, suspendedAt: new Date(now) },
    },
    now,
  );
  assert.equal(suspended.status, "critical");
  assert.match(suspended.description, /installation is suspended/);
  assert.doesNotMatch(suspended.description, /confirmed access/);
});

void test("unchecked installations request verification without claiming success", () => {
  const check = githubHealthCheck({ ...input, signal: undefined }, now);
  assert.equal(check.status, "attention");
  assert.equal(check.checkedAt, null);
  assert.match(check.description, /run checks to verify access/);
});

void test("failed checks keep their critical status and failure detail after expiry", () => {
  const failed = {
    ...input,
    signal: {
      ...input.signal,
      status: "critical",
      message: "GitHub could not verify the connected App installation.",
    },
  };
  assert.equal(
    githubHealthCheck(failed, now).description,
    failed.signal.message,
  );
  const stale = githubHealthCheck(failed, now + 25 * 60 * 60_000);
  assert.equal(stale.status, "critical");
  assert.match(stale.description, /Last result: GitHub could not verify/);
  assert.equal(
    stale.remediationHref,
    "/manage/integrations?integration=github",
  );
});
