"use client";
import { ScoutIcon } from "./scout-icons";
import { useState } from "react";
import { Button } from "@workspace/web-design-system/buttons/button";
import { useApiQuery } from "@/hooks/use-api-query";
import type { ScoutIncident } from "./scout-controls";
export type ScoutOverviewIdentity = {
  serverName: string;
  workload: {
    environmentName: string;
    name: string;
    kind: string;
    sourceId: string;
    archivedAt: string | null;
  } | null;
};
export type OverviewIncident = ScoutOverviewIdentity & {
  incident: ScoutIncident & { serverId: string };
};
export function entityLabel(
  row: ScoutOverviewIdentity,
  owner: { deployableId: string | null },
) {
  return owner.deployableId
    ? row.workload
      ? `${row.workload.name} · ${row.workload.environmentName}`
      : "Removed workload"
    : row.serverName;
}
export function useWorkspaceIncidents<T>(
  state: "active" | "resolved",
  severity: "all" | "critical" | "warning",
) {
  const filterKey = `${state}:${severity}`;
  const [cursorState, setCursorState] = useState({
    key: filterKey,
    cursors: [""],
  });
  const cursors = cursorState.key === filterKey ? cursorState.cursors : [""];
  const setCursors = (value: string[] | ((old: string[]) => string[])) =>
    setCursorState({
      key: filterKey,
      cursors: typeof value === "function" ? value(cursors) : value,
    });
  const query = useApiQuery<{
    items: T[];
    nextBefore: string | null;
    nextBeforeId: string | null;
  }>(
    `/v1/core/monitoring/incidents?state=${state}&severity=${severity}&limit=20${cursors.at(-1)}`,
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
          variant="secondary"
          isDisabled={cursors.length === 1 || query.isPreviousData}
          onPress={() => setCursors((old) => old.slice(0, -1))}
        >
          <ScoutIcon name="previous" />
          Previous
        </Button>
        <Button
          variant="secondary"
          isDisabled={!query.data?.nextBefore || query.isPreviousData}
          onPress={() =>
            setCursors((old) => [
              ...old,
              `&before=${encodeURIComponent(query.data!.nextBefore!)}&beforeId=${query.data!.nextBeforeId}`,
            ])
          }
        >
          <ScoutIcon name="next" />
          Next
        </Button>
      </div>
    ),
  };
}
