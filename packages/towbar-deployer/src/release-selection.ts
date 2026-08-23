import type { DeploymentExecutionContext } from "./types.js";

/**
 * Selects the immutable image used by an execution. Normal deployments own the
 * image they build and may remove it on failure. Rollbacks reuse a retained
 * image, so failure cleanup must never delete that shared release artifact.
 */
export function selectDeploymentImage(
  context: Pick<DeploymentExecutionContext, "kind" | "rollbackRelease">,
  generatedImageTag: string,
) {
  if (context.kind === "deploy") {
    if (context.rollbackRelease) {
      throw new Error("Deploy execution cannot include a rollback release");
    }
    return { imageTag: generatedImageTag, removeOnFailure: true };
  }
  if (!context.rollbackRelease) {
    throw new Error("Rollback deployment is missing its retained release");
  }
  return {
    imageTag: context.rollbackRelease.imageTag,
    removeOnFailure: false,
  } as const;
}
