import {
  condition,
  defineSignal,
  executeChild,
  proxyActivities,
  setHandler,
} from "@temporalio/workflow";

import { deploymentWorkflowId } from "@workspace/towbar-core/temporal";

import type * as activities from "../activities/index.js";
import { runDeploymentWorkflow } from "./deployment.workflow.js";

type ServerWorkItem = {
  id: string;
  kind: "deployment" | "server-check";
};

const enqueueServerWork = defineSignal<[ServerWorkItem]>("enqueueServerWork");
const { executeServerCheckActivity } = proxyActivities<typeof activities>({
  heartbeatTimeout: "30 seconds",
  retry: { maximumAttempts: 1 },
  startToCloseTimeout: "2 minutes",
});

export async function runServerCoordinatorWorkflow() {
  const queue: ServerWorkItem[] = [];
  const seen = new Set<string>();
  setHandler(enqueueServerWork, (item) => {
    if (seen.has(item.id)) return;
    seen.add(item.id);
    queue.push(item);
  });
  for (;;) {
    const available = await condition(() => queue.length > 0, "10 minutes");
    if (!available) return;
    const item = queue.shift();
    if (!item) continue;
    if (item.kind === "server-check") {
      await executeServerCheckActivity(item.id).catch(() => undefined);
      continue;
    }
    await executeChild(runDeploymentWorkflow, {
      args: [{ deploymentId: item.id }],
      workflowId: deploymentWorkflowId(item.id),
    }).catch(() => undefined);
  }
}
