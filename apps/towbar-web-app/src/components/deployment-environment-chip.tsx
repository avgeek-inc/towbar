import { Chip } from "@workspace/web-design-system/data-display/chip";
import type { Deployment } from "@workspace/towbar-web-client";
import { EnvironmentIcon } from "./environment-icon";

export function DeploymentEnvironmentChip({
  deployment,
}: {
  deployment: Pick<Deployment, "environment" | "targetEnvironment">;
}) {
  const preview = deployment.environment === "preview";
  const environmentName = preview
    ? "preview"
    : deployment.targetEnvironment.name;
  const production = environmentName === "production";
  return (
    <Chip
      size="small"
      variant={production ? "destructive" : "secondary"}
      icon={<EnvironmentIcon className="text-current" name={environmentName} />}
      tooltip={
        preview
          ? `Pull-request preview targeting ${deployment.targetEnvironment.name}`
          : `Deployment environment: ${deployment.targetEnvironment.name}`
      }
    >
      {environmentName}
    </Chip>
  );
}
