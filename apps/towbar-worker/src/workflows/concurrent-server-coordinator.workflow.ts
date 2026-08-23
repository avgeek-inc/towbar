import {
  condition,
  defineSignal,
  executeChild,
  proxyActivities,
  setHandler,
} from "@temporalio/workflow";

import {
  deploymentWorkflowId,
  resourceOperationWorkflowId,
} from "@workspace/towbar-core/temporal";

import type * as activities from "../activities/index.js";
import { runDeploymentWorkflow } from "./deployment.workflow.js";
import { runResourceOperationWorkflow } from "./resource-operation.workflow.js";
import { nextServerWorkIndex } from "./server-scheduling.js";
import type { ServerWorkItem } from "./server-scheduling.js";

const enqueueServerWork = defineSignal<[ServerWorkItem]>("enqueueServerWork");
const { executeServerCheckActivity } = proxyActivities<typeof activities>({
  heartbeatTimeout: "30 seconds",
  retry: { maximumAttempts: 1 },
  startToCloseTimeout: "2 minutes",
});

export async function runConcurrentServerCoordinatorWorkflow() {
  const queue: ServerWorkItem[] = [];
  const seen = new Set<string>();
  const active = new Map<string, { appId: string | null }>();
  const completed: string[] = [];
  let buildConcurrency = 1;
  setHandler(enqueueServerWork, (item) => {
    if (seen.has(item.id)) return;
    seen.add(item.id);
    buildConcurrency = Math.max(1, Math.min(16, item.buildConcurrency ?? 1));
    queue.push(item);
  });
  for (;;) {
    while (completed.length > 0) {
      const completedId = completed.shift();
      if (completedId) active.delete(completedId);
    }

    for (;;) {
      const index = nextServerWorkIndex({
        activeAppIds: activeAppIds(active),
        activeCount: active.size,
        buildConcurrency,
        queue,
      });
      if (index < 0) break;
      const [item] = queue.splice(index, 1);
      if (!item) break;
      const completion = executeServerWork(item);
      void completion
        .catch(() => undefined)
        .then(() => {
          completed.push(item.id);
        });
      active.set(item.id, {
        appId:
          item.kind === "deployment" || item.kind === "resource-operation"
            ? item.appId
            : null,
      });
    }

    if (queue.length === 0 && active.size === 0) {
      const available = await condition(() => queue.length > 0, "10 minutes");
      if (!available) return;
      continue;
    }
    await condition(
      () =>
        completed.length > 0 ||
        nextServerWorkIndex({
          activeAppIds: activeAppIds(active),
          activeCount: active.size,
          buildConcurrency,
          queue,
        }) >= 0,
    );
  }
}

function executeServerWork(item: ServerWorkItem) {
  if (item.kind === "server-check") {
    return executeServerCheckActivity(item.id).then(() => undefined);
  }
  if (item.kind === "resource-operation") {
    return executeChild(runResourceOperationWorkflow, {
      args: [{ operationId: item.id }],
      workflowId: resourceOperationWorkflowId(item.id),
    }).then(() => undefined);
  }
  return executeChild(runDeploymentWorkflow, {
    args: [{ deploymentId: item.id }],
    workflowId: deploymentWorkflowId(item.id),
  }).then(() => undefined);
}

function activeAppIds(active: Map<string, { appId: string | null }>) {
  return new Set(
    [...active.values()]
      .map((work) => work.appId)
      .filter((appId): appId is string => Boolean(appId)),
  );
}
