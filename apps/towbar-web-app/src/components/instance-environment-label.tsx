import {
  TableCellStack,
  TableCellDescription,
} from "@workspace/towbar-web-ui/table-cell-text";
import { GitBranchIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { InstanceEnvironment } from "@workspace/towbar-web-client";
import { TooltipText } from "@workspace/web-design-system/overlays/tooltip";
import { EnvironmentChip } from "./environment-chip";

export function InstanceEnvironmentLabel({
  environment,
  repositoryName,
}: {
  environment: InstanceEnvironment | null;
  repositoryName?: string;
}) {
  if (!environment) return <span className="text-muted">—</span>;
  return (
    <TableCellStack className="justify-items-start">
      <EnvironmentChip name={environment.name} />
      <TableCellDescription className="inline-flex items-center gap-1">
        <HugeiconsIcon
          aria-hidden="true"
          icon={GitBranchIcon}
          className="size-[1em] shrink-0"
        />
        <TooltipText
          className="font-mono"
          tooltip={repositoryName ? `Repository: ${repositoryName}` : undefined}
        >
          {environment.branch}
        </TooltipText>
        {environment.disconnectedAt ? " · Disconnected" : ""}
      </TableCellDescription>
    </TableCellStack>
  );
}
