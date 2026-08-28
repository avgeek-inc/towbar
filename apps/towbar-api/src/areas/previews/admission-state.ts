export function shouldDeferPreviewAdmission(status: string | undefined) {
  return status === "deleting";
}

export function isPreviewReleaseCurrent(
  currentDeploymentDigest: string | null | undefined,
  desiredDeploymentDigest: string,
) {
  return currentDeploymentDigest === desiredDeploymentDigest;
}
