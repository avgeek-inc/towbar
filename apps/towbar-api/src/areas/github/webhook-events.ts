const previewPullRequestActions = new Set([
  "closed",
  "edited",
  "opened",
  "reopened",
  "synchronize",
]);

export function shouldReconcilePreviewPullRequest(action: string) {
  return previewPullRequestActions.has(action);
}
