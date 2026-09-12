import { Rocket01Icon, ServerStack01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Chip } from "@workspace/web-design-system/data-display/chip";
import type { Deployment } from "@workspace/towbar-web-client";

export function DeploymentEnvironmentChip({
  deployment,
}: {
  deployment: Pick<Deployment, "environment" | "targetEnvironment">;
}) {
  const preview = deployment.environment === "preview";
  return (
    <Chip
      size="small"
      variant="secondary"
      icon={<HugeiconsIcon icon={preview ? Rocket01Icon : ServerStack01Icon} />}
    >
      {deployment.targetEnvironment.name}
      {preview ? " · Preview" : ""}
    </Chip>
  );
}
