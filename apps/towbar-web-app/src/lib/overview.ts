import type { App, Resource } from "@workspace/towbar-web-client";

export function workloadAttention(
  item: Pick<App | Resource, "runtimeState" | "serverReady">,
) {
  const runtime = item.runtimeState;
  if (runtime.healthStatus === "unhealthy")
    return { status: "unhealthy", label: "Unhealthy" };
  if (
    runtime.desiredState === "running" &&
    ["missing", "stopped"].includes(runtime.observedState)
  )
    return { status: "failed", label: "Not running" };
  if (!item.serverReady)
    return { status: "warning", label: "Server not ready" };
  if (runtime.driftStatus === "drifted")
    return { status: "warning", label: "Configuration drift" };
  return null;
}
