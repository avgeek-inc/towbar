import { continueAsNew, proxyActivities, sleep } from "@temporalio/workflow";

import type * as activities from "../activities/index.js";

const { recordDatabaseStorageSampleActivity } = proxyActivities<
  typeof activities
>({
  retry: {
    initialInterval: "10 seconds",
    maximumAttempts: 5,
    maximumInterval: "1 minute",
  },
  startToCloseTimeout: "1 minute",
});

export async function runDatabaseStorageWorkflow() {
  for (let run = 0; run < 180; run += 1) {
    await recordDatabaseStorageSampleActivity();
    await sleep("2 hours");
  }
  await continueAsNew<typeof runDatabaseStorageWorkflow>();
}
