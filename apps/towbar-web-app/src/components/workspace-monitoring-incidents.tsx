"use client";
import { ScoutIcon } from "./scout-icons";
import { useState } from "react";
import { AlertCircleIcon } from "@hugeicons/core-free-icons";
import { Button } from "@workspace/web-design-system/buttons/button";
import { Chip } from "@workspace/web-design-system/data-display/chip";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import {
  ResourceTable,
  type ResourceTableColumn,
} from "@workspace/towbar-web-ui/resource-table";
import { DashboardPage } from "./page-parts";
import {
  ScoutSelect,
  conditionDescription,
  scoutValue,
} from "./scout-controls";
import { ScoutIncidentDrawer, incidentTime } from "./scout-incident-drawer";
import {
  entityLabel,
  useMonitoringOverview,
  type OverviewIncident,
} from "./workspace-monitoring-shared";

export function WorkspaceIncidents() {
  const [state, setState] = useState("all");
  const [selected, setSelected] = useState<OverviewIncident | null>(null);
  const { query, pagination, reset } = useMonitoringOverview<OverviewIncident>(
    "incidents",
    state,
  );
  const columns: ResourceTableColumn<OverviewIncident>[] = [
    {
      key: "incident",
      header: "Incident",
      cell: ({ incident }) => (
        <div className="grid gap-1">
          <span className="font-medium">{incident.ruleName}</span>
          <span className="text-sm text-muted">
            {conditionDescription(incident.condition)}
          </span>
        </div>
      ),
    },
    {
      key: "entity",
      header: "Entity",
      cell: (row) => (
        <div className="grid gap-1">
          <span>{entityLabel(row, row.incident)}</span>
          <span className="text-xs text-muted">
            {row.incident.deployableId ? row.serverName : "Server"}
          </span>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: ({ incident }) => (
        <Chip
          size="small"
          variant={
            incident.resolvedAt
              ? "secondary"
              : incident.severity === "critical"
                ? "destructive"
                : "warning"
          }
        >
          {incident.resolvedAt
            ? incident.resolutionReason === "recovered"
              ? "Recovered"
              : "Closed"
            : incident.severity === "critical"
              ? "Critical"
              : "Warning"}
        </Chip>
      ),
    },
    {
      key: "started",
      header: "Started",
      cell: ({ incident }) => incidentTime(incident.openedAt),
    },
    {
      key: "ended",
      header: "Ended",
      cell: ({ incident }) =>
        incident.resolvedAt ? incidentTime(incident.resolvedAt) : "Ongoing",
    },
    {
      key: "reading",
      header: "Reading",
      cell: ({ incident }) =>
        scoutValue(incident.lastValue, incident.condition.metric),
    },
    {
      key: "view",
      header: "",
      cell: (row) => (
        <Button size="sm" variant="secondary" onPress={() => setSelected(row)}>
          <ScoutIcon name="view" />
          View Incident
        </Button>
      ),
    },
  ];
  return (
    <DashboardPage title="Incidents" icon={AlertCircleIcon}>
      <div className="grid gap-5">
        <div className="flex justify-end">
          <div className="w-48">
            <ScoutSelect
              label="Show incidents"
              value={state}
              onChange={(value) => {
                setState(value);
                reset();
              }}
              options={[
                { id: "all", label: "All incidents" },
                { id: "active", label: "Active" },
                { id: "resolved", label: "Resolved" },
              ]}
            />
          </div>
        </div>
        {query.error ? <QueryError message={query.error} /> : null}
        {query.data ? (
          <ResourceTable
            ariaLabel="Workspace incidents"
            columns={columns}
            getRowKey={(row) => row.incident.id}
            items={query.data.items}
            emptyTitle="No incidents in this view"
            emptyDescription="Incidents across your servers, apps, and resources appear here."
          />
        ) : !query.error ? (
          <QueryLoading />
        ) : null}
        {pagination}
        {selected ? (
          <ScoutIncidentDrawer
            serverId={selected.incident.serverId}
            incident={selected.incident}
            onClose={() => setSelected(null)}
          />
        ) : null}
      </div>
    </DashboardPage>
  );
}
