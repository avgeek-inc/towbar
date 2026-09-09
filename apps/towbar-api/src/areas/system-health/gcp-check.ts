import type { SystemHealthCheck } from "@workspace/towbar-core";

export function gcpHealthCheck(
  credential: {
    clientEmail: string;
    lastVerifiedAt: Date | null;
    projectId: string;
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
    "Run checks to verify the connected Google Cloud credentials.";
  return {
    checkedAt: credential.lastVerifiedAt?.toISOString() ?? null,
    description: `${message}.${stale ? " The latest check is stale; run checks to verify access." : ""}`,
    id: "gcp",
    remediationHref:
      status === "healthy" ? null : "/manage/integrations?integration=gcp",
    remediationLabel:
      status === "healthy" ? null : "Open Google Cloud integration",
    status,
    title: "Google Cloud",
  };
}
