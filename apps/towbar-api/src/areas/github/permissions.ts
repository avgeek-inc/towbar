export type GitHubPermissionLevel = "none" | "read" | "write";

export type GitHubPermissionReadiness = {
  checks: GitHubPermissionLevel;
  contents: GitHubPermissionLevel;
  deployments: GitHubPermissionLevel;
  planning: "missing" | "ready";
  preview: "missing" | "ready";
  pullRequests: GitHubPermissionLevel;
};

export function githubPermissionReadiness(
  permissions: Record<string, string>,
): GitHubPermissionReadiness {
  const checks = normalizePermission(permissions.checks);
  const contents = normalizePermission(permissions.contents);
  const deployments = normalizePermission(permissions.deployments);
  const pullRequests = normalizePermission(permissions.pull_requests);
  return {
    checks,
    contents,
    deployments,
    planning: canRead(contents) && checks === "write" ? "ready" : "missing",
    preview:
      canRead(contents) && deployments === "write" && pullRequests === "write"
        ? "ready"
        : "missing",
    pullRequests,
  };
}

function normalizePermission(value: string | undefined): GitHubPermissionLevel {
  if (value === "write" || value === "admin") return "write";
  return value === "read" ? "read" : "none";
}

function canRead(permission: GitHubPermissionLevel) {
  return permission === "read" || permission === "write";
}
