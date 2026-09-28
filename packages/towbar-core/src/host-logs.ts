import { isNormalizedApp } from "./manifest.js";
import type { NormalizedDeployable } from "./manifest.js";

export function collectsHostDockerLogs(deployable: NormalizedDeployable) {
  return (
    isNormalizedApp(deployable) &&
    deployable.container.hostLogs?.dockerJsonFiles === true
  );
}
