import {
  condition,
  defineSignal,
  proxyActivities,
  setHandler,
  sleep,
} from "@temporalio/workflow";

import type * as activities from "../activities/index.js";
import type { PreviewPullRequestEvent } from "@workspace/towbar-core/temporal";

const previewPullRequestEvent = defineSignal<[PreviewPullRequestEvent]>(
  "previewPullRequestEvent",
);
const { processPreviewPullRequestEventActivity } = proxyActivities<
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
  let pending: PreviewPullRequestEvent | null = null;
  setHandler(previewPullRequestEvent, (event) => {
    pending = event;
  });

  for (;;) {
    const available = await condition(() => pending !== null, "30 minutes");
    if (!available) return;
    const event: PreviewPullRequestEvent | null = pending;
    pending = null;
    if (!event) continue;
    const result = await processPreviewPullRequestEventActivity(event);
    if (result.retry) {
      if (pending === null) pending = event;
      await sleep("15 seconds");
    }
  }
}
