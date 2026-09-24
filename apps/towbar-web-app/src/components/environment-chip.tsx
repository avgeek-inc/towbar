import { Chip } from "@workspace/web-design-system/data-display/chip";
import { EnvironmentIcon } from "./environment-icon";

export function EnvironmentChip({
  name,
  showIcon = true,
  tooltip = `Environment: ${name}`,
}: {
  name: string;
  showIcon?: boolean;
  tooltip?: string;
}) {
  return (
    <Chip
      size="small"
      variant={name === "production" ? "destructive" : "secondary"}
      icon={
        showIcon ? (
          <EnvironmentIcon className="text-current" name={name} />
        ) : undefined
      }
      tooltip={tooltip}
    >
      {name}
    </Chip>
  );
}
