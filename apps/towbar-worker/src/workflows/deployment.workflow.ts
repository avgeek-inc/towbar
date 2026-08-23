import { CancellationScope, proxyActivities } from "@temporalio/workflow";

import type * as activities from "../activities/index.js";

const { executeDeploymentActivity, markDeploymentWaitingActivity } =
  proxyActivities<typeof activities>({
    heartbeatTimeout: "30 seconds",
    retry: { maximumAttempts: 1 },
    startToCloseTimeout: "60 minutes",
  });
const { recoverDeploymentActivity } = proxyActivities<typeof activities>({
  retry: {
    initialInterval: "2 seconds",
    maximumAttempts: 10,
    maximumInterval: "30 seconds",
  },
  startToCloseTimeout: "5 minutes",
});
const { continueAutomaticDeploymentsActivity } = proxyActivities<
  typeof activities
>({
  retry: {
    initialInterval: "2 seconds",
    maximumAttempts: 10,
    maximumInterval: "30 seconds",
  },
  startToCloseTimeout: "5 minutes",
});

export async function runDeploymentWorkflow(input: { deploymentId: string }) {
  await markDeploymentWaitingActivity(input.deploymentId);
  try {
    await executeDeploymentActivity(input.deploymentId);
  } catch (error) {
    const outcome = await CancellationScope.nonCancellable(() =>
      recoverDeploymentActivity(input.deploymentId),
    );
    if (outcome !== "succeeded") throw error;
  }
  await continueAutomaticDeploymentsActivity(input.deploymentId);
}
