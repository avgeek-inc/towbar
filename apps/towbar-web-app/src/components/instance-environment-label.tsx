import {
  TableCellStack,
  TableCellDescription,
} from "@workspace/towbar-web-ui/table-cell-text";
import { GitBranchIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { InstanceEnvironment } from "@workspace/towbar-web-client";
import { EnvironmentIcon } from "./environment-icon";

export function InstanceEnvironmentLabel({
  environment,
}: {
  environment: InstanceEnvironment | null;
}) {
  if (!environment) return <span className="text-muted">—</span>;
  return (
    <TableCellStack>
      <span className="inline-flex items-center gap-2">
        <EnvironmentIcon name={environment.name} />
        <span>{environment.name}</span>
      </span>
      <TableCellDescription className="inline-flex items-center gap-1">
        <HugeiconsIcon
          aria-hidden="true"
          icon={GitBranchIcon}
          className="size-[1em] shrink-0"
        />
        <span className="font-mono">{environment.branch}</span>
        {environment.disconnectedAt ? " · Disconnected" : ""}
      </TableCellDescription>
    </TableCellStack>
  );
}
