import type { Source } from "@workspace/towbar-web-client";

export function repositoryFileLink(
  source: Pick<
    Source,
    "provider" | "repositoryUrl" | "repositoryOwner" | "repositoryName"
  >,
  revision: string,
  filePath: string,
) {
  const provider = source.provider === "gitlab" ? "GitLab" : "GitHub";
  const repositoryPath = [source.repositoryOwner, source.repositoryName]
    .flatMap((part) => part.split("/"))
    .map(encodeURIComponent)
    .join("/");
  const base = (
    source.repositoryUrl ??
    `https://${source.provider === "gitlab" ? "gitlab.com" : "github.com"}/${repositoryPath}`
  )
    .replace(/\/+$/u, "")
    .replace(/\.git$/u, "");
  const blob = source.provider === "gitlab" ? "-/blob" : "blob";
  const path = filePath.split("/").map(encodeURIComponent).join("/");
  return {
    href: `${base}/${blob}/${encodeURIComponent(revision)}/${path}`,
    label: `Open in ${provider}`,
  };
}
