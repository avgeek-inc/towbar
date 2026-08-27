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
const { executeServerPreparationActivity } = proxyActivities<typeof activities>(
  {
    heartbeatTimeout: "30 seconds",
    retry: { maximumAttempts: 1 },
    startToCloseTimeout: "30 minutes",
  },
);
const { executePreviewCleanupActivity } = proxyActivities<typeof activities>({
  retry: {
    initialInterval: "2 seconds",
    maximumAttempts: 3,
    maximumInterval: "30 seconds",
  },
  startToCloseTimeout: "5 minutes",
});

export async function runConcurrentServerCoordinatorWorkflow() {
  const queue: ServerWorkItem[] = [];
  const seen = new Set<string>();
  const active = new Map<string, { appId: string | null; preview: boolean }>();
  const completed: string[] = [];
  let buildConcurrency = 1;
  let previewBuildConcurrency = 1;
  setHandler(enqueueServerWork, (item) => {
    if (seen.has(item.id)) return;
    seen.add(item.id);
    buildConcurrency = Math.max(1, Math.min(16, item.buildConcurrency ?? 1));
    previewBuildConcurrency = Math.max(
      1,
      Math.min(
        buildConcurrency,
        item.kind === "deployment" || item.kind === "preview-cleanup"
          ? (item.previewBuildConcurrency ?? 1)
          : 1,
      ),
    );
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
        activePreviewCount: activePreviewCount(active),
        buildConcurrency,
        previewBuildConcurrency,
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
          item.kind === "deployment" ||
          item.kind === "resource-operation" ||
          item.kind === "preview-cleanup"
            ? item.appId
            : null,
        preview: item.kind === "deployment" && item.priority === "preview",
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
          activePreviewCount: activePreviewCount(active),
          buildConcurrency,
          previewBuildConcurrency,
          queue,
        }) >= 0,
    );
  }
}

function executeServerWork(item: ServerWorkItem) {
  if (item.kind === "server-check") {
    return executeServerCheckActivity(item.id).then(() => undefined);
  }
  if (item.kind === "server-preparation") {
    return executeServerPreparationActivity(item.id).then(() => undefined);
  }
  if (item.kind === "resource-operation") {
    return executeChild(runResourceOperationWorkflow, {
      args: [{ operationId: item.id }],
      workflowId: resourceOperationWorkflowId(item.id),
    }).then(() => undefined);
  }
  if (item.kind === "preview-cleanup") {
    return executePreviewCleanupActivity(item.id).then(() => undefined);
  }
  return executeChild(runDeploymentWorkflow, {
    args: [{ deploymentId: item.id }],
    workflowId: deploymentWorkflowId(item.id),
  }).then(() => undefined);
}

function activeAppIds(
  active: Map<string, { appId: string | null; preview: boolean }>,
) {
  return new Set(
    [...active.values()]
      .map((work) => work.appId)
      .filter((appId): appId is string => Boolean(appId)),
  );
}

function activePreviewCount(
  active: Map<string, { appId: string | null; preview: boolean }>,
) {
  return [...active.values()].filter((work) => work.preview).length;
}
