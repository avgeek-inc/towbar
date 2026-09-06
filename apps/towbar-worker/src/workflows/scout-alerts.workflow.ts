import {
  condition,
  continueAsNew,
  defineSignal,
  proxyActivities,
  setHandler,
} from "@temporalio/workflow";
import type * as activities from "../activities/index.js";

const wakeScoutAlerts = defineSignal("wakeScoutAlerts");
const { evaluateScoutAlertsActivity } = proxyActivities<typeof activities>({
  startToCloseTimeout: "1 minute",
  retry: {
    initialInterval: "5 seconds",
    maximumInterval: "15 seconds",
    maximumAttempts: 3,
  },
});

export async function runScoutAlertsWorkflow() {
  let wake = false;
  setHandler(wakeScoutAlerts, () => {
    wake = true;
  });
  for (let run = 0; run < 720; run++) {
    wake = false;
    const started = Date.now();
    const result = await evaluateScoutAlertsActivity().catch(() => null);
    await condition(
      () => wake,
      result?.more ? 1000 : Math.max(1000, 30_000 - (Date.now() - started)),
    );
  }
  await continueAsNew<typeof runScoutAlertsWorkflow>();
}
