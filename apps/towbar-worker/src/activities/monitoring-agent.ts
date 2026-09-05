import path from "node:path";
import { Context } from "@temporalio/activity";
import {
  type MonitoringAgentExecutionContext,
  reconcileMonitoringAgent,
} from "@workspace/towbar-deployer";
import { signedApiRequest } from "../infrastructure/towbar-api.js";

export async function executeMonitoringAgentActivity(input: {
  serverId: string;
  generation: string;
}) {
  const activity = Context.current();
  const pulse = setInterval(() => activity.heartbeat(input), 10_000);
  try {
    // Credentials stay inside the activity and never become a workflow result.
    const { context } = await signedApiRequest<{
      context: MonitoringAgentExecutionContext | null;
    }>(
      "GET",
      `/v1/internal/monitoring/${input.serverId}/${input.generation}/context`,
    );
    if (!context) return;
    await reconcileMonitoringAgent(
      context,
      process.env.TOWBAR_MONITORING_BINARY_DIR ??
        path.resolve("monitoring-agent"),
      activity.cancellationSignal,
    );
    await signedApiRequest(
      "POST",
      `/v1/internal/monitoring/${input.serverId}/${input.generation}/complete`,
      { succeeded: true },
    );
  } catch {
    // SSH output can contain sensitive configuration; never serialize it into Temporal failure history.
    throw new Error("Monitoring agent operation failed");
  } finally {
    clearInterval(pulse);
  }
}
export async function failMonitoringAgentActivity(input: {
  serverId: string;
  generation: string;
}) {
  await signedApiRequest(
    "POST",
    `/v1/internal/monitoring/${input.serverId}/${input.generation}/complete`,
    { succeeded: false },
  );
}
