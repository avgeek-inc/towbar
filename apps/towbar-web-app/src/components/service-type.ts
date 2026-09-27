import type { App } from "@workspace/towbar-web-client";

const deploymentLabels = {
  buildpack: "Buildpacks",
  dockerfile: "Dockerfile",
  image: "OCI image",
  nixpacks: "Nixpacks",
  railpack: "Railpack",
  static: "Static site",
} as const;

export function serviceTypeLabel(app: App): string {
  if (app.config.kind === "compose") return "Compose";
  return deploymentLabels[app.config.deployment?.type ?? "dockerfile"];
}
