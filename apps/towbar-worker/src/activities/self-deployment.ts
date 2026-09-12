import {
  type DeploymentExecutionContext,
  deploymentRuntimeId,
} from "@workspace/towbar-deployer";

export function isWorkerSelfDeployment(
  workerRuntimeId: string | undefined,
  context: DeploymentExecutionContext,
) {
  return (
    Boolean(workerRuntimeId) && workerRuntimeId === deploymentRuntimeId(context)
  );
}
