import { Chip } from "@workspace/web-design-system/data-display/chip";
import { EnvironmentIcon } from "./environment-icon";

export function EnvironmentChip({
  name,
  tooltip = `Environment: ${name}`,
}: {
  name: string;
  tooltip?: string;
}) {
  return (
    <Chip
      size="small"
      variant={name === "production" ? "destructive" : "secondary"}
      icon={<EnvironmentIcon className="text-current" name={name} />}
      tooltip={tooltip}
    >
      {name}
    </Chip>
  );
}
