import type { GitHubPullRequest } from "../github/client.js";

export type PreviewPullRequestDisposition =
  { action: "deploy" } | { action: "cleanup"; reason: string };

export function previewPullRequestsToReconcile(
  openPullRequestNumbers: number[],
  existingPullRequestNumbers: number[],
) {
  return [
    ...new Set([...openPullRequestNumbers, ...existingPullRequestNumbers]),
  ];
}

export function previewPullRequestDisposition(input: {
  pullRequest: GitHubPullRequest;
  repositoryName: string;
  repositoryOwner: string;
  sourceBranch: string;
}): PreviewPullRequestDisposition {
  const { pullRequest } = input;
  if (pullRequest.state === "closed") {
    return {
      action: "cleanup",
      reason: pullRequest.merged
        ? `Pull request #${pullRequest.number} was merged`
        : `Pull request #${pullRequest.number} was closed`,
    };
  }

  const sourceRepository = `${input.repositoryOwner}/${input.repositoryName}`;
  if (
    !pullRequest.headRepository ||
    !sameRepository(pullRequest.headRepository, sourceRepository)
  ) {
    return {
      action: "cleanup",
      reason:
        "Preview deployments are unavailable for pull requests from forks",
    };
  }
  if (!sameRepository(pullRequest.baseRepository, sourceRepository)) {
    return {
      action: "cleanup",
      reason: "The pull request no longer targets the Source repository",
    };
  }
  if (pullRequest.baseBranch !== input.sourceBranch) {
    return {
      action: "cleanup",
      reason: `The pull request no longer targets '${input.sourceBranch}'`,
    };
  }
  return { action: "deploy" };
}

function sameRepository(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase();
}
