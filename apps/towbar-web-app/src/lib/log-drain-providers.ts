import type { LogDrainProvider } from "@workspace/towbar-core";

export const logDrainNames = {
  newrelic: "New Relic",
  axiom: "Axiom",
  betterstack: "Better Stack",
  datadog: "Datadog",
  otlp: "OpenTelemetry (OTLP)",
  loki: "Grafana Cloud / Loki",
} satisfies Record<LogDrainProvider, string>;

export function logDrainStatus(configuration?: {
  state?: string;
  health?: { status: string; retryAt: string | null }[];
}) {
  if (!configuration) return { status: "pending", label: "Not configured" };
  if (configuration.state === "paused")
    return { status: "pending", label: "Paused after restore" };
  if (configuration.health?.some((item) => item.status === "auth_failure"))
    return { status: "failed", label: "Auth failure" };
  if (configuration.health?.some((item) => item.status === "rate_limited"))
    return { status: "warning", label: "Rate limited" };
  if (configuration.health?.some((item) => item.status === "retrying"))
    return { status: "retrying", label: "Retrying" };
  return { status: "configured", label: "Configured" };
}
