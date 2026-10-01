import { parseDocument } from "yaml";
import type { App, Resource } from "@workspace/towbar-web-client";

export type ManifestFile = { path: string; content: string };
export type ManifestDeployable = Pick<
  App | Resource,
  "kind" | "manifestId" | "environment"
>;

export function findDeployableManifest(
  files: ManifestFile[],
  deployable: ManifestDeployable,
): ManifestFile | undefined {
  const directory =
    deployable.kind === "app" || deployable.kind === "compose"
      ? "services"
      : "datastores";
  const suffix =
    deployable.kind === "app"
      ? "service"
      : deployable.kind === "compose"
        ? "compose"
        : "datastore";
  return files.find((file) => {
    if (
      !file.path.startsWith(`.towbar/${directory}/`) ||
      !file.path.endsWith(`.${suffix}.yml`)
    )
      return false;
    const document = parseDocument(file.content);
    return (
      document.errors.length === 0 &&
      document.get("id") === deployable.manifestId
    );
  });
}
