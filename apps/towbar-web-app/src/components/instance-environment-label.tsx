import {
  TableCellStack,
  TableCellDescription,
} from "@workspace/towbar-web-ui/table-cell-text";
import type { InstanceEnvironment } from "@workspace/towbar-web-client";
import { EnvironmentChip } from "./environment-chip";

export function InstanceEnvironmentLabel({
  environment,
}: {
  environment: InstanceEnvironment | null;
}) {
  if (!environment) return <span className="text-muted">—</span>;
  return (
    <TableCellStack className="justify-items-start">
      <EnvironmentChip name={environment.name} />
      {environment.disconnectedAt && (
        <TableCellDescription>Disconnected</TableCellDescription>
      )}
    </TableCellStack>
  );
}
