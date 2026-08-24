import { Chip } from "@workspace/web-design-system/data-display/chip";

const success = new Set([
  "active",
  "approved",
  "connected",
  "current",
  "healthy",
  "live",
  "ready",
  "succeeded",
  "trusted",
  "verified",
]);
const warning = new Set([
  "building",
  "checking_health",
  "checking_public_endpoint",
  "checking_server",
  "cleaning_up",
  "configuring_routing",
  "fetching_source",
  "preparing",
  "provisioning_tls",
  "queued",
  "resolving_secrets",
  "running",
  "running_post_deploy",
  "running_pre_deploy",
  "starting_candidate",
  "switching_traffic",
  "transferring",
  "validating_credentials",
  "degraded",
  "drifted",
  "connecting",
  "reconnecting",
  "succeeded_with_warnings",
  "unverified",
  "untrusted",
  "waiting",
  "waiting_for_server",
  "server_setup_pending",
  "pending",
]);
const destructive = new Set([
  "decommissioned",
  "failed",
  "suspended",
  "unhealthy",
]);

export function StatusBadge({ status }: { status: string }) {
  const variant = success.has(status)
    ? "success"
    : warning.has(status)
      ? "warning"
      : destructive.has(status)
        ? "destructive"
        : "secondary";
  return <Chip variant={variant}>{formatStatus(status)}</Chip>;
}

export function formatStatus(status: string) {
  if (status === "none") return "No health check";
  return status
    .split("_")
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}
