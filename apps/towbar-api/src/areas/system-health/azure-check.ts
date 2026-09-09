import type { SystemHealthCheck } from "@workspace/towbar-core";

export function azureHealthCheck(
  credential: {
    clientId: string;
    lastVerifiedAt: Date | null;
    status: "unverified" | "verified" | "failed";
    tenantId: string;
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
    "Run checks to verify the connected Azure credentials.";
  return {
    checkedAt: credential.lastVerifiedAt?.toISOString() ?? null,
    description: `${message}.${stale ? " The latest check is stale; run checks to verify access." : ""}`,
    id: "azure",
    remediationHref:
      status === "healthy" ? null : "/manage/integrations?integration=azure",
    remediationLabel: status === "healthy" ? null : "Open Azure integration",
    status,
    title: "Azure",
  };
}
