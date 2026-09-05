import type {
  SystemHealthCheck,
  SystemHealthStatus,
} from "@workspace/towbar-core";

import { systemHealthStatusSchema } from "./signals.js";
import type { SystemHealthSignal } from "./signals.js";

export function githubHealthCheck(
  input: {
    configured: boolean;
    connection: { accountLogin: string; suspendedAt: Date | null } | undefined;
    signal:
      Pick<SystemHealthSignal, "checkedAt" | "message" | "status"> | undefined;
  },
  now = Date.now(),
): SystemHealthCheck {
  let status: SystemHealthStatus;
  let description: string;
  if (!input.configured) {
    status = "critical";
    description =
      "Complete the GitHub App environment before connecting repositories.";
  } else if (!input.connection) {
    status = "attention";
    description = "Install the GitHub App before adding a Source.";
  } else if (input.connection.suspendedAt) {
    status = "critical";
    description =
      "The GitHub App installation is suspended. Restore access in GitHub, then run checks.";
  } else if (!input.signal) {
    status = "attention";
    description = `Connected to ${input.connection.accountLogin}; run checks to verify access.`;
  } else {
    status = systemHealthStatusSchema.parse(input.signal.status);
    const stale = now - input.signal.checkedAt.getTime() > 24 * 60 * 60_000;
    if (stale) {
      status = status === "critical" ? "critical" : "attention";
      description = `The last GitHub access check is more than 24 hours old. Run checks to verify access to ${input.connection.accountLogin}. Last result: ${input.signal.message}`;
    } else {
      description = input.signal.message;
    }
  }
  return {
    checkedAt: input.signal?.checkedAt.toISOString() ?? null,
    description,
    id: "github",
    remediationHref:
      status === "healthy" ? null : "/manage/integrations?integration=github",
    remediationLabel: status === "healthy" ? null : "Open GitHub integration",
    status,
    title: "GitHub App",
  };
}
