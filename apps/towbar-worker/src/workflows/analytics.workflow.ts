import { continueAsNew, proxyActivities, sleep } from "@temporalio/workflow";
import type * as activities from "../activities/index.js";
const { maintainAnalyticsActivity } = proxyActivities<typeof activities>({
  startToCloseTimeout: "5 minutes",
  retry: { initialInterval: "1 minute", maximumInterval: "1 hour" },
});
export async function runAnalyticsWorkflow() {
  for (let day = 0; day < 30; day += 1) {
    await maintainAnalyticsActivity();
    await sleep("24 hours");
  }
  await continueAsNew<typeof runAnalyticsWorkflow>();
}
