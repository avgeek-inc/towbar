export type GitHubPermissionLevel = "none" | "read" | "write";

export type GitHubPermissionReadiness = {
  contents: GitHubPermissionLevel;
  deployments: GitHubPermissionLevel;
  preview: "missing" | "ready";
  pullRequests: GitHubPermissionLevel;
};

export function githubPermissionReadiness(
  permissions: Record<string, string>,
): GitHubPermissionReadiness {
  const contents = normalizePermission(permissions.contents);
  const deployments = normalizePermission(permissions.deployments);
  const pullRequests = normalizePermission(permissions.pull_requests);
  return {
    contents,
    deployments,
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
