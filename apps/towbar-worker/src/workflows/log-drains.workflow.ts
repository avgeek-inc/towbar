import {
  condition,
  continueAsNew,
  defineSignal,
  proxyActivities,
  setHandler,
} from "@temporalio/workflow";
import type * as activities from "../activities/log-drains.js";
const wakeLogDrains = defineSignal("wakeLogDrains");
const { listLogDrainServersActivity } = proxyActivities<typeof activities>({
  startToCloseTimeout: "45 seconds",
  retry: { maximumAttempts: 1 },
});
const { reconcileLogDrainServerActivity } = proxyActivities<typeof activities>({
  startToCloseTimeout: "4 minutes",
  heartbeatTimeout: "45 seconds",
  retry: { maximumAttempts: 1 },
});
export async function runLogDrainsWorkflow() {
  let wake = false;
  setHandler(wakeLogDrains, () => {
    wake = true;
  });
  for (let count = 0; count < 500; count++) {
    wake = false;
    const servers = await listLogDrainServersActivity().catch(() => []);
    for (let start = 0; start < servers.length; start += 5) {
      await Promise.all(
        servers
          .slice(start, start + 5)
          .map(({ serverId }) =>
            reconcileLogDrainServerActivity(serverId).catch(() => undefined),
          ),
      );
    }
    await condition(() => wake, "1 minute");
  }
  await continueAsNew<typeof runLogDrainsWorkflow>();
}
