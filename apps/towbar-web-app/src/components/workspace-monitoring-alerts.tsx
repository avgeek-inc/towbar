"use client";
import { useMonitoringSelection } from "@/hooks/use-monitoring-selection";
import { MonitoringEntityPicker } from "./monitoring-entity-picker";
import { ScoutIcon } from "./scout-icons";
import { Notification01Icon } from "@hugeicons/core-free-icons";
import { Chip } from "@workspace/web-design-system/data-display/chip";
import { ButtonLink } from "@workspace/web-design-system/buttons/button";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import {
  ResourceTable,
  type ResourceTableColumn,
} from "@workspace/towbar-web-ui/resource-table";
import { PageSelectionTitle } from "./page-selection-title";
import { DashboardPage } from "./page-parts";
import { conditionDescription, scoutValue } from "./scout-controls";
import {
  entityLabel,
  scoutHome,
  useMonitoringOverview,
  type OverviewRule,
} from "./workspace-monitoring-shared";

export function WorkspaceAlerts() {
  const {
    kind,
    setKind,
    selected,
    select: setSelected,
    entityKey,
    resolve,
  } = useMonitoringSelection();
  const { query, pagination, reset } = useMonitoringOverview<OverviewRule>(
    "alerts",
    "all",
    `&kind=${kind}${selected ? `&entityId=${selected.id}` : ""}`,
  );
  const columns: ResourceTableColumn<OverviewRule>[] = [
    {
      key: "rule",
      header: "Alert",
      cell: ({ rule }) => (
        <div className="grid gap-1">
          <span>{rule.name}</span>
          <span className="text-sm text-muted">
            {conditionDescription(rule.condition)}
          </span>
        </div>
      ),
    },
    {
      key: "entity",
      header: "Entity",
      cell: (row) => (
        <div className="grid gap-1">
          <span>{entityLabel(row, row.rule)}</span>
          <span className="text-xs text-muted">
            {row.rule.deployableId
              ? `${row.serverName} · ${row.rule.environment === "preview" ? "Previews" : "Production"}`
              : "Server"}
          </span>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: ({ rule }) => {
        const muted =
          rule.mutedUntil && new Date(rule.mutedUntil).getTime() > Date.now();
        return (
          <Chip
            size="small"
            icon={
              <ScoutIcon
                name={
                  !rule.enabled || muted
                    ? "mute"
                    : rule.evaluationState === "healthy"
                      ? "resolved"
                      : rule.evaluationState === "firing"
                        ? rule.severity === "critical"
                          ? "critical"
                          : "warning"
                        : rule.evaluationState === "error"
                          ? "critical"
                          : "time"
                }
              />
            }
            variant={
              !rule.enabled || muted
                ? "secondary"
                : rule.evaluationState === "firing"
                  ? rule.severity === "critical"
                    ? "destructive"
                    : "warning"
                  : rule.evaluationState === "healthy"
                    ? "success"
                    : rule.evaluationState === "error"
                      ? "destructive"
                      : rule.evaluationState === "pending"
                        ? "warning"
                        : "secondary"
            }
          >
            {!rule.enabled
              ? "Paused"
              : muted
                ? "Muted"
                : ({
                    firing: "Alerting",
                    healthy: "Healthy",
                    unknown: "No recent data",
                    inactive: "Scout inactive",
                    error: "Evaluation error",
                    pending: "Evaluating",
                  }[rule.evaluationState] ?? "Evaluating")}
          </Chip>
        );
      },
    },
    {
      key: "severity",
      header: "Severity",
      cell: ({ rule }) => (
        <Chip
          size="small"
          icon={
            <ScoutIcon
              name={rule.severity === "critical" ? "critical" : "warning"}
            />
          }
          variant={rule.severity === "critical" ? "destructive" : "warning"}
        >
          {rule.severity === "critical" ? "Critical" : "Warning"}
        </Chip>
      ),
    },
    {
      key: "reading",
      header: "Latest reading",
      cell: ({ rule }) => scoutValue(rule.observedValue, rule.condition.metric),
    },
    {
      key: "home",
      header: "",
      cell: (row) => {
        const href = scoutHome(row, row.rule);
        return href ? (
          <ButtonLink
            href={href}
            size="sm"
            variant="secondary"
            className="whitespace-nowrap"
          >
            <ScoutIcon name="view" />
            View alert
          </ButtonLink>
        ) : (
          <span className="text-sm text-muted">Entity removed</span>
        );
      },
    },
  ];
  return (
    <DashboardPage
      title={selected ? `${selected.name} · Alerts` : "Alerts"}
      icon={Notification01Icon}
    >
      {selected ? (
        <PageSelectionTitle
          label={`${selected.name} · Alerts`}
          icon={<ScoutIcon name={selected.kind} />}
        />
      ) : null}
      <div className="grid gap-5">
        <p className="text-sm text-muted">
          All configured alerts. Open an alert’s entity to manage its rules.
        </p>
        <MonitoringEntityPicker
          allowAll
          kind={kind}
          entityKey={entityKey}
          onResolve={resolve}
          onKindChange={(value) => {
            setKind(value);
            reset();
          }}
          selected={selected}
          onSelect={(entity, replace) => {
            setSelected(entity, replace);
            reset();
          }}
        />
        {query.error ? <QueryError message={query.error} /> : null}
        {entityKey && !selected ? (
          <p className="text-sm text-muted">
            Select an available entity to view its alerts.
          </p>
        ) : query.data ? (
          <ResourceTable
            ariaLabel="Workspace alerts"
            columns={columns}
            getRowKey={(row) => row.rule.id}
            items={query.data.items}
            emptyTitle="No alerts configured"
            emptyDescription="Create rules in a server, app, or resource’s Scout Agent → Alerts page."
          />
        ) : !query.error ? (
          <QueryLoading />
        ) : null}
        {pagination}
      </div>
    </DashboardPage>
  );
}
