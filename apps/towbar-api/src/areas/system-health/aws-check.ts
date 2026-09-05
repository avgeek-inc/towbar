import type { SystemHealthCheck } from "@workspace/towbar-core";

export function awsHealthCheck(
  credential: {
    lastVerifiedAt: Date | null;
    region: string;
    status: "unverified" | "verified" | "failed";
    verificationMessage: string | null;
  },
  now = Date.now(),
): SystemHealthCheck {
  const stale =
    credential.lastVerifiedAt !== null &&
    now - credential.lastVerifiedAt.getTime() > 24 * 60 * 60_000;
  const status =
    credential.status === "failed"
      ? "critical"
      : credential.status !== "verified" || !credential.lastVerifiedAt
        ? "unknown"
        : stale
          ? "attention"
          : "healthy";
  const message =
    credential.verificationMessage ??
    "Run checks to verify the connected AWS credentials.";
  return {
    id: "aws",
    title: "AWS",
    status,
    checkedAt: credential.lastVerifiedAt?.toISOString() ?? null,
    description: `${message} Region: ${credential.region}.${stale ? " The latest check is stale; run checks to verify access." : ""}`,
    remediationHref:
      status === "healthy" ? null : "/manage/integrations?integration=aws",
    remediationLabel: status === "healthy" ? null : "Open AWS integration",
  };
}
