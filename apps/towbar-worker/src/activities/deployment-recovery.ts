import type { DeploymentState } from "@workspace/towbar-core/temporal";

export function composeCommitNeedsReconciliation(status: {
  committed: boolean;
  compose: boolean;
  state: DeploymentState;
}) {
  return (
    status.compose &&
    !status.committed &&
    ["switching_traffic", "cleaning_up"].includes(status.state)
  );
}
