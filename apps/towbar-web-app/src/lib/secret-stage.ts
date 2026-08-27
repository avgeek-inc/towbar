import type { AppSecretBinding } from "@workspace/towbar-web-client";

export type SecretStageGroup =
  "build" | "deployment" | "preview_build" | "preview_deployment";

export function belongsToSecretStageGroup(
  stage: AppSecretBinding["uses"][number]["stage"],
  group: SecretStageGroup,
) {
  switch (group) {
    case "build":
      return stage === "build";
    case "preview_build":
      return stage === "preview_build";
    case "preview_deployment":
      return stage.startsWith("preview_") && stage !== "preview_build";
    case "deployment":
      return !stage.startsWith("preview_") && stage !== "build";
  }
}
