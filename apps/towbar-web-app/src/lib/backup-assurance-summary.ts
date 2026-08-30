import type { BackupAssurance } from "@workspace/towbar-web-client";

const assuranceGroups = [
  {
    message: "Backup is current and available",
    name: "availability",
    checks: ["freshness", "object_exists", "size"],
  },
  {
    message: "Integrity and encryption are verified",
    name: "integrity",
    checks: ["checksum", "encryption"],
  },
  {
    message: "Engine and format are compatible",
    name: "compatibility",
    checks: ["engine", "format"],
  },
] as const;

export function summarizeAssuranceChecks(checks: BackupAssurance["checks"]) {
  return assuranceGroups.map((group) => {
    const groupedChecks = checks.filter((check) =>
      group.checks.some((name) => name === check.name),
    );
    const failure = groupedChecks.find((check) => !check.passed);
    const complete = groupedChecks.length === group.checks.length;
    return {
      message:
        failure?.message ??
        (complete ? group.message : "Verification details are incomplete"),
      name: group.name,
      passed: complete && failure === undefined,
    };
  });
}
