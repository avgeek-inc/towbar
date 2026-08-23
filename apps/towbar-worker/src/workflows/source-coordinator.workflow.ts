import {
  condition,
  defineSignal,
  proxyActivities,
  setHandler,
} from "@temporalio/workflow";

import type * as activities from "../activities/index.js";

const enqueueSourceSync = defineSignal<[string]>("enqueueSourceSync");
const { executeSourceSyncActivity } = proxyActivities<typeof activities>({
  retry: {
    initialInterval: "2 seconds",
    maximumAttempts: 3,
    maximumInterval: "15 seconds",
  },
  startToCloseTimeout: "5 minutes",
});

export async function runSourceCoordinatorWorkflow() {
  const queue: string[] = [];
  const seen = new Set<string>();
  setHandler(enqueueSourceSync, (syncId) => {
    if (seen.has(syncId)) return;
    seen.add(syncId);
    queue.push(syncId);
  });
  for (;;) {
    const available = await condition(() => queue.length > 0, "5 minutes");
    if (!available) return;
    const syncId = queue.shift();
    if (!syncId) continue;
    await executeSourceSyncActivity(syncId).catch(() => undefined);
  }
}
