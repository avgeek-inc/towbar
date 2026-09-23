import type { Deployment } from "@workspace/towbar-web-client";
import { EnvironmentChip } from "./environment-chip";

export function DeploymentEnvironmentChip({
  deployment,
}: {
  deployment: Pick<Deployment, "environment" | "targetEnvironment">;
}) {
  const preview = deployment.environment === "preview";
  const environmentName = preview
    ? "preview"
    : deployment.targetEnvironment.name;
  return (
    <EnvironmentChip
      name={environmentName}
      tooltip={
        preview
          ? `Pull-request preview targeting ${deployment.targetEnvironment.name}`
          : `Deployment environment: ${deployment.targetEnvironment.name}`
      }
    />
  );
}
