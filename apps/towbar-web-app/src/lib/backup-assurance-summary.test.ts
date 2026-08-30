import assert from "node:assert/strict";
import test from "node:test";

import type { BackupAssurance } from "@workspace/towbar-web-client";

import { summarizeAssuranceChecks } from "./backup-assurance-summary";

const passingChecks: BackupAssurance["checks"] = [
  { message: "Fresh", name: "freshness", passed: true },
  { message: "Exists", name: "object_exists", passed: true },
  { message: "Sized", name: "size", passed: true },
  { message: "Checksum", name: "checksum", passed: true },
  { message: "Encrypted", name: "encryption", passed: true },
  { message: "Engine", name: "engine", passed: true },
  { message: "Format", name: "format", passed: true },
];

test("summarizes seven passing assurance checks into three groups", () => {
  assert.deepEqual(summarizeAssuranceChecks(passingChecks), [
    {
      message: "Backup is current and available",
      name: "availability",
      passed: true,
    },
    {
      message: "Integrity and encryption are verified",
      name: "integrity",
      passed: true,
    },
    {
      message: "Engine and format are compatible",
      name: "compatibility",
      passed: true,
    },
  ]);
});

test("preserves the first failure detail within its summary group", () => {
  const checks = passingChecks.map((check) =>
    check.name === "checksum"
      ? { ...check, message: "Checksum does not match", passed: false }
      : check,
  );

  assert.deepEqual(summarizeAssuranceChecks(checks)[1], {
    message: "Checksum does not match",
    name: "integrity",
    passed: false,
  });
});

test("does not report an incomplete group as verified", () => {
  const checks = passingChecks.filter((check) => check.name !== "format");

  assert.deepEqual(summarizeAssuranceChecks(checks)[2], {
    message: "Verification details are incomplete",
    name: "compatibility",
    passed: false,
  });
});
