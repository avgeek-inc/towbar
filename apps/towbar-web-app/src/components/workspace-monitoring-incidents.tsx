"use client";
import { SecondaryItems } from "./secondary-sidebar";
import { MonitoringEntityPicker } from "./monitoring-entity-picker";
import { useMonitoringSelection } from "@/hooks/use-monitoring-selection";
import { ScoutIcon } from "./scout-icons";
import { useState } from "react";
import { useQueryChoice } from "@/hooks/use-page-query";
import {
  AlertCircleIcon,
  CheckmarkCircle02Icon,
} from "@hugeicons/core-free-icons";
import { Button } from "@workspace/web-design-system/buttons/button";
import { Chip } from "@workspace/web-design-system/data-display/chip";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import {
  ResourceTable,
  type ResourceTableColumn,
} from "@workspace/towbar-web-ui/resource-table";
import { DashboardPage } from "./page-parts";
import { PageSelectionTitle } from "./page-selection-title";
import { conditionDescription, scoutValue } from "./scout-controls";
import { RelativeTime } from "./last-synced-time";
import { ScoutIncidentDrawer } from "./scout-incident-drawer";
import {
  entityLabel,
  useMonitoringOverview,
  type OverviewIncident,
} from "./workspace-monitoring-shared";

export function WorkspaceIncidents() {
  const {
    kind,
    setKind,
    selected: selectedEntity,
    select: setSelectedEntity,
    entityKey,
    resolve,
  } = useMonitoringSelection();
  const [state, setState] = useQueryChoice(
    "state",
    ["all", "active", "resolved"],
    "all",
  );
  const [selected, setSelected] = useState<OverviewIncident | null>(null);
  const { query, pagination, reset } = useMonitoringOverview<OverviewIncident>(
    "incidents",
    state,
    `&kind=${kind}${selectedEntity ? `&entityId=${selectedEntity.id}` : ""}`,
  );
  const columns: ResourceTableColumn<OverviewIncident>[] = [
    {
      key: "incident",
      header: "Incident",
      className: "min-w-72",
      cell: ({ incident }) => (
        <div className="grid gap-0.5">
          <span>{incident.ruleName}</span>
          <span className="text-xs text-muted">
            {conditionDescription(incident.condition)}
          </span>
        </div>
      ),
    },
    {
      key: "entity",
      header: "Entity",
      cell: (row) => (
        <div className="grid min-w-40 gap-0.5">
          <span className="whitespace-nowrap">
            {entityLabel(row, row.incident)}
          </span>
          <span className="text-xs text-muted">
            {row.incident.deployableId
              ? row.workload?.kind === "app"
                ? "App"
                : "Resource"
              : "Server"}
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
          icon={
            <ScoutIcon
              name={
                incident.resolvedAt
                  ? incident.resolutionReason === "recovered"
                    ? "resolved"
                    : "close"
                  : incident.severity === "critical"
                    ? "critical"
                    : "warning"
              }
            />
          }
          variant={
            incident.resolvedAt
              ? incident.resolutionReason === "recovered"
                ? "success"
                : "secondary"
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
        <Button size="sm" variant="secondary" onPress={() => setSelected(row)}>
          <ScoutIcon name="view" />
          View Incident
        </Button>
      ),
    },
  ];
  return (
    <DashboardPage
      title={
        selectedEntity
          ? `${selectedEntity.name} · ${state === "active" ? "Active incidents" : state === "resolved" ? "Resolved incidents" : "All incidents"}`
          : state === "active"
            ? "Active incidents"
            : state === "resolved"
              ? "Resolved incidents"
              : "All incidents"
      }
      icon={state === "resolved" ? CheckmarkCircle02Icon : AlertCircleIcon}
    >
      {selectedEntity ? (
        <PageSelectionTitle
          label={`${selectedEntity.name} · ${state === "active" ? "Active incidents" : state === "resolved" ? "Resolved incidents" : "All incidents"}`}
          icon={<ScoutIcon name={selectedEntity.kind} />}
        />
      ) : null}
      <SecondaryItems
        title="Incident status"
        selected={state}
        onSelect={(value) => {
          setState(value);
          reset();
        }}
        items={[
          { id: "all", label: "All incidents", icon: <ScoutIcon name="all" /> },
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
      <MonitoringEntityPicker
        allowAll
        kind={kind}
        entityKey={entityKey}
        onResolve={resolve}
        onKindChange={(value) => {
          setKind(value);
          reset();
        }}
        selected={selectedEntity}
        onSelect={(entity, replace) => {
          setSelectedEntity(entity, replace);
          reset();
        }}
      />
      <div className="grid gap-5">
        {query.error ? <QueryError message={query.error} /> : null}
        {entityKey && !selectedEntity ? (
          <p className="text-sm text-muted">
            Select an available entity to view its incidents.
          </p>
        ) : query.data ? (
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
