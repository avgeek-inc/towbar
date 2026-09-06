"use client";
import { Notification01Icon } from "@hugeicons/core-free-icons";
import { Chip } from "@workspace/web-design-system/data-display/chip";
import { ButtonLink } from "@workspace/web-design-system/buttons/button";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import {
  ResourceTable,
  type ResourceTableColumn,
} from "@workspace/towbar-web-ui/resource-table";
import { DashboardPage } from "./page-parts";
import { conditionDescription, scoutValue } from "./scout-controls";
import {
  entityLabel,
  scoutHome,
  useMonitoringOverview,
  type OverviewRule,
} from "./workspace-monitoring-shared";

export function WorkspaceAlerts() {
  const { query, pagination } = useMonitoringOverview<OverviewRule>("alerts");
  const columns: ResourceTableColumn<OverviewRule>[] = [
    {
      key: "rule",
      header: "Alert",
      cell: ({ rule }) => (
        <div className="grid gap-1">
          <span className="font-medium">{rule.name}</span>
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
            variant={
              rule.enabled && !muted && rule.evaluationState === "firing"
                ? "destructive"
                : rule.enabled && !muted && rule.evaluationState === "healthy"
                  ? "success"
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
      cell: ({ rule }) =>
        rule.severity === "critical" ? "Critical" : "Warning",
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
          <ButtonLink href={href} size="sm" variant="secondary">
            View alert
          </ButtonLink>
        ) : (
          <span className="text-sm text-muted">Entity removed</span>
        );
      },
    },
  ];
  return (
    <DashboardPage title="Alerts" icon={Notification01Icon}>
      <div className="grid gap-5">
        <p className="text-sm text-muted">
          All configured alerts. Open an alert’s entity to manage its rules.
        </p>
        {query.error ? <QueryError message={query.error} /> : null}
        {query.data ? (
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
