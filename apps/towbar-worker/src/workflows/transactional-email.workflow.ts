import { proxyActivities, sleep } from "@temporalio/workflow";
import type * as activities from "../activities/index.js";
const { deliverTransactionalEmailActivity } = proxyActivities<
  typeof activities
>({
  startToCloseTimeout: "1 minute",
  retry: {
    initialInterval: "2 seconds",
    maximumInterval: "30 seconds",
    maximumAttempts: 3,
  },
});
export async function runTransactionalEmailWorkflow(input: {
  outboxId: string;
}) {
  for (let step = 0; step < 20; step++) {
    const result = await deliverTransactionalEmailActivity(input);
    if (result.outcome === "done") return;
    await sleep(result.retryAfterMs);
  }
}
