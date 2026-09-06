"use client";
import { useState } from "react";
import { Button } from "@workspace/web-design-system/buttons/button";
import { useApiQuery } from "@/hooks/use-api-query";
import type { ScoutIncident, ScoutRule } from "./scout-controls";

export type MonitoringEntity = {
  id: string;
  key: string;
  name: string;
  kind: "server" | "app" | "resource";
  serverId: string;
  serverName: string;
  sourceId: string | null;
};
export type ScoutOverviewIdentity = {
  serverName: string;
  workload: {
    name: string;
    kind: string;
    sourceId: string;
    archivedAt: string | null;
  } | null;
};
export type OverviewRule = ScoutOverviewIdentity & {
  rule: ScoutRule & { serverId: string };
};
export type OverviewIncident = ScoutOverviewIdentity & {
  incident: ScoutIncident & { serverId: string };
};
export function scoutHome(
  row: ScoutOverviewIdentity,
  owner: { serverId: string; deployableId: string | null },
) {
  if (!owner.deployableId)
    return `/servers/${owner.serverId}?section=monitoring&scout=alerts`;
  if (!row.workload || row.workload.archivedAt) return null;
  return `/sources/${row.workload.sourceId}/${row.workload.kind === "app" ? "apps" : "resources"}/${owner.deployableId}?section=monitoring&scout=alerts`;
}
export function entityLabel(
  row: ScoutOverviewIdentity,
  owner: { deployableId: string | null },
) {
  return owner.deployableId
    ? (row.workload?.name ?? "Removed workload")
    : row.serverName;
}
export function useMonitoringOverview<T>(
  area: "alerts" | "incidents",
  state = "all",
) {
  const [cursors, setCursors] = useState<string[]>([""]);
  const query = useApiQuery<{
    items: T[];
    nextBefore: string | null;
    nextBeforeId: string | null;
  }>(
    `/v1/core/monitoring/${area}?state=${state}&limit=20${cursors.at(-1)}`,
    30_000,
    { keepPreviousData: true },
  );
  return {
    query,
    reset: () => setCursors([""]),
    pagination: (
      <div className="flex items-center justify-end gap-3">
        <span className="text-sm text-muted">Page {cursors.length}</span>
        <Button
          size="sm"
          variant="secondary"
          isDisabled={cursors.length === 1 || query.isPreviousData}
          onPress={() => setCursors((old) => old.slice(0, -1))}
        >
          Previous
        </Button>
        <Button
          size="sm"
          variant="secondary"
          isDisabled={!query.data?.nextBefore || query.isPreviousData}
          onPress={() =>
            setCursors((old) => [
              ...old,
              `&before=${encodeURIComponent(query.data!.nextBefore!)}&beforeId=${query.data!.nextBeforeId}`,
            ])
          }
        >
          Next
        </Button>
      </div>
    ),
  };
}
