import { terminalDeploymentStates } from "@workspace/towbar-core/temporal";

import type { DeploymentState } from "@workspace/towbar-core/temporal";

export function shouldDeferPreviewAdmission(status: string | undefined) {
  return status === "deleting";
}

export function previewAdmissionReplayAction(input: {
  deploymentErrorCode: string | null;
  deploymentState: DeploymentState;
  environmentStatus: string;
}) {
  if (
    input.environmentStatus === "deleted" ||
    input.environmentStatus === "cleanup_failed"
  ) {
    return "replace" as const;
  }
  if (
    input.deploymentState === "failed" &&
    input.deploymentErrorCode === "TEMPORAL_UNAVAILABLE"
  ) {
    return "reset_and_enqueue" as const;
  }
  return terminalDeploymentStates.has(input.deploymentState)
    ? ("reuse" as const)
    : ("enqueue" as const);
}

export function isPreviewReleaseCurrent(
  currentDeploymentDigest: string | null | undefined,
  desiredDeploymentDigest: string,
) {
  return currentDeploymentDigest === desiredDeploymentDigest;
}

export function previewAdmissionLockKey(input: {
  appId: string;
  gitRef: string;
  sourceId: string;
}) {
  return `preview-admission:${input.sourceId}:${input.appId}:${input.gitRef}`;
}

export function previewDeploymentIdempotencyKey(input: {
  commitSha: string;
  deploymentDigest: string;
  environmentId: string;
}) {
  return `preview:${input.environmentId}:${input.commitSha}:${input.deploymentDigest}`;
}
