export type AutoDeployPauseScope = "deployable" | "source";

export type DeferredAutomaticDeployment = {
  commitSha: string;
  deploymentDigest: string;
  deferredAt: string;
  manifestId: string;
  reason: "paused";
  scope: AutoDeployPauseScope;
};

export type AutoDeployPauseGate =
  | { paused: false; scope: null }
  | { paused: true; scope: AutoDeployPauseScope };

export function evaluateAutoDeployPause(input: {
  deployablePaused?: boolean;
  sourcePaused: boolean;
}): AutoDeployPauseGate {
  if (input.sourcePaused) return { paused: true, scope: "source" };
  if (input.deployablePaused) return { paused: true, scope: "deployable" };
  return { paused: false, scope: null };
}
