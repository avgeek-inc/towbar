import type { Server, ServerPreparation } from "@workspace/towbar-web-client";

export function serverPreparationIndicator(input: {
  latestPreparation: ServerPreparation | undefined;
  setupStatus: Server["setupStatus"];
}): "busy" | "warning" | undefined {
  if (
    input.setupStatus === "preparing" ||
    input.latestPreparation?.status === "queued" ||
    input.latestPreparation?.status === "running"
  )
    return "busy";
  if (input.setupStatus !== "ready") return "warning";
  return undefined;
}

export function shouldShowServerPreparation(input: {
  latestPreparation: ServerPreparation | undefined;
  setupStatus: Server["setupStatus"];
}) {
  return (
    (input.setupStatus === "pending" || input.setupStatus === "failed") &&
    serverPreparationIndicator(input) !== "busy"
  );
}
