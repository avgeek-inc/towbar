"use client";

import {
  TableCellStack,
  TableCellDescription,
} from "@workspace/towbar-web-ui/table-cell-text";

import { SecondaryItems, SecondarySection } from "./secondary-sidebar";
import { ScoutIcon } from "./scout-icons";
import { useState } from "react";
import { useQueryChoice } from "@/hooks/use-page-query";
import {
  AlertCircleIcon,
  CheckmarkCircle02Icon,
} from "@hugeicons/core-free-icons";
import { Button } from "@workspace/web-design-system/buttons/button";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import {
  ResourceTable,
  type ResourceTableColumn,
} from "@workspace/towbar-web-ui/resource-table";
import { DashboardPage } from "./page-parts";
import {
  conditionDescription,
  ScoutSelect,
  scoutValue,
} from "./scout-controls";
import { RelativeTime } from "./last-synced-time";
import { ScoutIncidentDrawer } from "./scout-incident-drawer";
import {
  ScoutIncidentSeverityChip,
  ScoutIncidentStateChip,
} from "./scout-incident-chips";
import {
  entityLabel,
  useWorkspaceIncidents,
  type OverviewIncident,
} from "./workspace-monitoring-shared";

export function WorkspaceIncidents() {
  const [state, setState] = useQueryChoice(
    "state",
    ["active", "resolved"],
    "active",
  );
  const [severity, setSeverity] = useQueryChoice(
    "severity",
    ["all", "critical", "warning"],
    "all",
  );
  const [selected, setSelected] = useState<OverviewIncident | null>(null);
  const { query, pagination, reset } = useWorkspaceIncidents<OverviewIncident>(
    state,
    severity,
  );
  const columns: ResourceTableColumn<OverviewIncident>[] = [
    {
      key: "incident",
      header: "Incident",
      className: "min-w-72",
      cell: ({ incident }) => (
        <TableCellStack as="div">
          <span>{incident.ruleName}</span>
          <TableCellDescription>
            {conditionDescription(incident.condition)}
          </TableCellDescription>
        </TableCellStack>
      ),
    },
    {
      key: "entity",
      header: "Entity",
      cell: (row) => (
        <TableCellStack as="div" className="min-w-40">
          <span className="whitespace-nowrap">
            {entityLabel(row, row.incident)}
          </span>
          <TableCellDescription>
            {row.incident.deployableId
              ? row.workload?.kind === "app"
                ? "App"
                : "Resource"
              : "Server"}
          </TableCellDescription>
        </TableCellStack>
      ),
    },
    {
      key: "status",
      header: "State",
      cell: ({ incident }) => <ScoutIncidentStateChip incident={incident} />,
    },
    {
      key: "severity",
      header: "Severity",
      cell: ({ incident }) => (
        <ScoutIncidentSeverityChip severity={incident.severity} />
      ),
    },
    {
      key: "started",
      header: "Started",
      cell: ({ incident }) => (
        <RelativeTime label="Started" value={incident.openedAt} />
      ),
    },
    {
      key: "ended",
      header: "Ended",
      cell: ({ incident }) =>
        incident.resolvedAt ? (
          <RelativeTime label="Ended" value={incident.resolvedAt} />
        ) : (
          "Ongoing"
        ),
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
        <Button variant="secondary" onPress={() => setSelected(row)}>
          <ScoutIcon name="view" />
          View Incident
        </Button>
      ),
    },
  ];
  return (
    <DashboardPage
      title={state === "active" ? "Active incidents" : "Resolved incidents"}
      icon={state === "resolved" ? CheckmarkCircle02Icon : AlertCircleIcon}
    >
      <SecondaryItems
        title="Incident status"
        selected={state}
        onSelect={(value) => {
          setState(value);
          reset();
        }}
        items={[
          {
            id: "active",
            label: "Active",
            icon: <ScoutIcon name="critical" />,
          },
          {
            id: "resolved",
            label: "Resolved",
            icon: <ScoutIcon name="resolved" />,
          },
        ]}
      />
      <SecondarySection title="Filter incidents">
        <ScoutSelect
          label="Severity"
          value={severity}
          onChange={(value) => {
            setSeverity(value);
            reset();
          }}
          options={[
            { id: "all", label: "All severities" },
            { id: "critical", label: "Critical" },
            { id: "warning", label: "Warning" },
          ]}
        />
      </SecondarySection>
      <div className="grid gap-5">
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
