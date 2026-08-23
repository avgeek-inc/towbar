export class DeploymentCommittedError extends Error {
  constructor(cause: unknown) {
    super("Release committed before post-promotion bookkeeping completed", {
      cause,
    });
    this.name = "DeploymentCommittedError";
  }
}

export class DeploymentCommitUncertainError extends Error {
  constructor(cause: unknown) {
    super("Release commit outcome must be reconciled before cleanup", {
      cause,
    });
    this.name = "DeploymentCommitUncertainError";
  }
}

export function resolveDeploymentFailureBoundary(input: {
  commitAttempted: boolean;
  commitConfirmed: boolean;
}) {
  if (input.commitConfirmed) return "committed" as const;
  if (input.commitAttempted) return "commit-uncertain" as const;
  return "rollback" as const;
}
