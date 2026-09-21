import {
  condition,
  continueAsNew,
  defineSignal,
  proxyActivities,
  setHandler,
} from "@temporalio/workflow";
import type * as activities from "../activities/app-jobs.js";
const wakeAppJobs = defineSignal("wakeAppJobs");
const { queueScheduledAppJobsActivity } = proxyActivities<typeof activities>({
  startToCloseTimeout: "50 seconds",
  retry: { maximumAttempts: 1 },
});
export async function runAppJobsWorkflow() {
  let wake = false;
  setHandler(wakeAppJobs, () => {
    wake = true;
  });
  for (let count = 0; count < 1_440; count += 1) {
    wake = false;
    await queueScheduledAppJobsActivity().catch(() => undefined);
    await condition(() => wake, 60_000 - (Date.now() % 60_000));
  }
  await continueAsNew<typeof runAppJobsWorkflow>();
}
