import { proxyActivities } from "@temporalio/workflow";
import type * as activities from "../activities/index.js";

const { executeMonitoringAgentActivity, failMonitoringAgentActivity } =
  proxyActivities<typeof activities>({
    startToCloseTimeout: "5 minutes",
    heartbeatTimeout: "30 seconds",
    retry: {
      maximumAttempts: 3,
      initialInterval: "10 seconds",
      maximumInterval: "1 minute",
    },
  });
export async function runMonitoringAgentWorkflow(input: {
  serverId: string;
  generation: string;
}) {
  try {
    await executeMonitoringAgentActivity(input);
  } catch {
    await failMonitoringAgentActivity(input);
  }
}
