import { Layers01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { InstanceEnvironment } from "@workspace/towbar-web-client";

export function InstanceEnvironmentLabel({
  environment,
}: {
  environment: InstanceEnvironment | null;
}) {
  if (!environment) return <span className="text-muted">—</span>;
  return (
    <span className="grid gap-0.5">
      <span className="inline-flex items-center gap-2">
        <HugeiconsIcon
          aria-hidden="true"
          icon={Layers01Icon}
          className="size-4 shrink-0"
        />
        {environment.name}
      </span>
      <span className="text-xs text-muted">
        {environment.branch}
        {environment.disconnectedAt ? " · Disconnected" : ""}
      </span>
    </span>
  );
}
