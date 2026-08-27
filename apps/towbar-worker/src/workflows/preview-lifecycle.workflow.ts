import {
  condition,
  defineSignal,
  proxyActivities,
  setHandler,
  sleep,
} from "@temporalio/workflow";

import type * as activities from "../activities/index.js";
import type { PreviewBranchEvent } from "@workspace/towbar-core/temporal";

const previewBranchEvent =
  defineSignal<[PreviewBranchEvent]>("previewBranchEvent");
const { processPreviewBranchEventActivity } = proxyActivities<
  typeof activities
>({
  heartbeatTimeout: "30 seconds",
  retry: {
    initialInterval: "2 seconds",
    maximumAttempts: 10,
    maximumInterval: "30 seconds",
  },
  startToCloseTimeout: "5 minutes",
});

export async function runPreviewLifecycleWorkflow() {
  let pending: PreviewBranchEvent | null = null;
  setHandler(previewBranchEvent, (event) => {
    pending = event;
  });

  for (;;) {
    const available = await condition(() => pending !== null, "30 minutes");
    if (!available) return;
    const event: PreviewBranchEvent | null = pending;
    pending = null;
    if (!event) continue;
    const result = await processPreviewBranchEventActivity(event);
    if (result.retry) {
      if (pending === null) pending = event;
      await sleep("15 seconds");
    }
  }
}
