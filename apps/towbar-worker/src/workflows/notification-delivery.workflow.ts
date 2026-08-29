import { proxyActivities, sleep } from "@temporalio/workflow";

import type * as activities from "../activities/index.js";

const { executeNotificationDeliveryActivity } = proxyActivities<
  typeof activities
>({
  retry: {
    initialInterval: "1 second",
    maximumAttempts: 3,
    maximumInterval: "10 seconds",
  },
  startToCloseTimeout: "30 seconds",
});

export async function runNotificationDeliveryWorkflow(input: {
  cycle: number;
  deliveryId: string;
}) {
  let attempt = 1;
  while (attempt <= 5) {
    const result = await executeNotificationDeliveryActivity({
      ...input,
      attempt,
    });
    if (!("retryAfterMs" in result)) return;
    await sleep(result.retryAfterMs);
    if (result.outcome === "retryable") attempt += 1;
  }
}
