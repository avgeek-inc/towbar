import {
  Alert02Icon,
  AlertCircleIcon,
  CheckmarkCircle01Icon,
  Clock01Icon,
  InformationCircleIcon,
  PlayIcon,
  StopIcon,
  RefreshIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Chip } from "@workspace/web-design-system/data-display/chip";

const success = new Set([
  "active",
  "approved",
  "connected",
  "clean",
  "current",
  "success",
  "healthy",
  "in_sync",
  "online",
  "recovered",
  "live",
  "passed",
  "published",
  "ready",
  "restore_ready",
  "succeeded",
  "trusted",
  "verified",
]);
const warning = new Set([
  "building",
  "deleting",
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
  "waiting_for_server_capacity",
  "waiting_for_server_check",
  "waiting_for_server_operation",
  "waiting_for_server_preparation",
  "server_setup_pending",
  "pending",
  "stale",
  "delivering",
  "findings",
  "warning",
  "offline",
  "retrying",
]);
const destructive = new Set([
  "blocked",
  "decommissioned",
  "error",
  "failed",
  "cleanup_failed",
  "suspended",
  "unhealthy",
  "not_restore_ready",
]);

const progress = new Set([
  "building",
  "deleting",
  "checking_health",
  "checking_public_endpoint",
  "checking_server",
  "cleaning_up",
  "configuring_routing",
  "fetching_source",
  "preparing",
  "provisioning_tls",
  "resolving_secrets",
  "running",
  "running_post_deploy",
  "running_pre_deploy",
  "starting_candidate",
  "switching_traffic",
  "transferring",
  "validating_credentials",
  "connecting",
  "reconnecting",
  "delivering",
  "retrying",
]);

export function StatusBadge({
  status,
  context,
}: {
  status: string;
  context?: "runtime";
}) {
  const variant =
    success.has(status) || (context === "runtime" && status === "running")
      ? "success"
      : warning.has(status)
        ? "warning"
        : destructive.has(status)
          ? "destructive"
          : "secondary";
  const icon =
    status === "running" && context === "runtime"
      ? PlayIcon
      : status === "stopped" || status === "cancelled"
        ? StopIcon
        : variant === "success"
          ? CheckmarkCircle01Icon
          : variant === "destructive"
            ? AlertCircleIcon
            : status === "queued" ||
                status === "pending" ||
                status.startsWith("waiting")
              ? Clock01Icon
              : variant === "warning"
                ? progress.has(status)
                  ? RefreshIcon
                  : Alert02Icon
                : InformationCircleIcon;
  return (
    <Chip variant={variant} icon={<HugeiconsIcon icon={icon} />}>
      {formatStatus(status)}
    </Chip>
  );
}

export function formatStatus(status: string) {
  if (status === "none") return "No health check";
  return status
    .split("_")
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}
