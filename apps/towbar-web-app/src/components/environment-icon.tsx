import { CloudIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@workspace/web-design-system/lib/utils";

const environmentIcon = CloudIcon;

export function EnvironmentIcon({
  className,
  name,
}: {
  className?: string;
  name?: string;
}) {
  return (
    <HugeiconsIcon
      aria-hidden="true"
      className={cn(
        "size-4 shrink-0",
        name === "production" ? "text-danger" : "text-foreground",
        className,
      )}
      icon={environmentIcon}
    />
  );
}
