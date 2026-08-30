import { digestValue } from "@workspace/towbar-core";

export function pullRequestDeploymentPlanIdentity(input: {
  pullRequestNumber: number;
  sourceId: string;
  targetCommitSha: string;
}) {
  return digestValue({
    pullRequestNumber: input.pullRequestNumber,
    sourceId: input.sourceId,
    targetCommitSha: input.targetCommitSha,
    trigger: "pull_request",
  });
}
