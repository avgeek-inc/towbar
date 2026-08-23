import { CancellationScope, proxyActivities } from "@temporalio/workflow";

import type * as activities from "../activities/index.js";

const { executeResourceOperationActivity } = proxyActivities<typeof activities>(
  {
    heartbeatTimeout: "30 seconds",
    retry: { maximumAttempts: 1 },
    startToCloseTimeout: "90 minutes",
  },
);
const { markResourceOperationInterruptedActivity } = proxyActivities<
  typeof activities
>({
  retry: {
    initialInterval: "2 seconds",
    maximumAttempts: 10,
    maximumInterval: "30 seconds",
  },
  startToCloseTimeout: "5 minutes",
});

export async function runResourceOperationWorkflow(input: {
  operationId: string;
}) {
  try {
    await executeResourceOperationActivity(input.operationId);
  } catch (error) {
    await CancellationScope.nonCancellable(() =>
      markResourceOperationInterruptedActivity(input.operationId),
    );
    throw error;
  }
}
