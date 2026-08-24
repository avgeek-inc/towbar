type ServerSetupStatus = "pending" | "preparing" | "ready" | "failed";

type ServerPreparationStatus = "queued" | "running" | "succeeded" | "failed";

export function reconcileServerSetupStatus(
  serverStatus: ServerSetupStatus,
  preparationStatus: ServerPreparationStatus | undefined,
): ServerSetupStatus {
  if (serverStatus !== "preparing") return serverStatus;
  if (preparationStatus === "failed") return "failed";
  if (preparationStatus === "succeeded") return "ready";
  return serverStatus;
}
