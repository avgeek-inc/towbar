import {
  condition,
  continueAsNew,
  defineSignal,
  proxyActivities,
  setHandler,
} from "@temporalio/workflow";

import type * as activities from "../activities/index.js";

const wakeMaintenance = defineSignal("wakeMaintenance");
const { runMaintenanceSweepActivity } = proxyActivities<typeof activities>({
  retry: {
    initialInterval: "5 seconds",
    maximumAttempts: 5,
    maximumInterval: "1 minute",
  },
  startToCloseTimeout: "5 minutes",
});

export async function runMaintenanceWorkflow() {
  let wake = false;
  setHandler(wakeMaintenance, () => {
    wake = true;
  });
  for (let run = 0; run < 288; run += 1) {
    wake = false;
    await runMaintenanceSweepActivity().catch(() => undefined);
    await condition(() => wake, "5 minutes");
  }
  await continueAsNew<typeof runMaintenanceWorkflow>();
}
