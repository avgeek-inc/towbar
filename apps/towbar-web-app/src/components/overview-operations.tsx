"use client";
import { scoutCoverage } from "@/lib/overview";
import { conditionDescription } from "./scout-controls";
import { useState } from "react";
import {
  Activity01Icon,
  AlertCircleIcon,
  ServerStack01Icon,
  Rocket01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type {
  Server,
  DeploymentHistoryPage,
} from "@workspace/towbar-web-client";
import { Widget } from "@workspace/web-design-system/data-display/widget";
import { Button } from "@workspace/web-design-system/buttons/button";
import { StatusBadge } from "@workspace/towbar-web-ui/status-badge";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import { InlineLink } from "./page-parts";
import { RelativeTime } from "./last-synced-time";
import { useApiQuery } from "@/hooks/use-api-query";
import { ScoutIncidentDrawer } from "./scout-incident-drawer";
import { ScoutIcon } from "./scout-icons";
import {
  entityLabel,
  type OverviewIncident,
} from "./workspace-monitoring-shared";

export function OverviewIncidents() {
  const query = useApiQuery<{
    items: OverviewIncident[];
    nextBefore: string | null;
  }>("/v1/core/monitoring/incidents?state=active&limit=3", 30_000);
  const [selected, setSelected] = useState<OverviewIncident | null>(null);
  return (
    <>
      <Widget className="min-w-0">
        <Widget.Header
          className="flex-wrap gap-2 py-2"
          endContent={
            <InlineLink href="/monitoring/incidents" className="text-xs">
              All incidents
            </InlineLink>
          }
        >
          <Widget.Title icon={<HugeiconsIcon icon={AlertCircleIcon} />}>
            Active incidents
          </Widget.Title>
        </Widget.Header>
        <Widget.Content className="grid content-start">
          {query.error ? (
            <QueryError message={query.error} />
          ) : !query.data ? (
            <QueryLoading />
          ) : query.data.items.length ? (
            <ul className="divide-y divide-separator">
              {query.data.items.map((row) => (
                <li
                  key={row.incident.id}
                  className="grid gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{row.incident.ruleName}</span>
                    <StatusBadge status={row.incident.severity} />
                  </div>
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div className="grid gap-1 text-xs text-muted">
                      <span>{entityLabel(row, row.incident)}</span>
                      <span>
                        {conditionDescription(row.incident.condition)}
                      </span>
                      <RelativeTime
                        label="Started"
                        value={row.incident.openedAt}
                      />
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      onPress={() => setSelected(row)}
                    >
                      <ScoutIcon name="view" />
                      View Incident
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="grid min-h-44 content-center justify-items-center gap-3 text-center">
              <StatusBadge status="healthy" label="No active incidents" />
              <p className="max-w-xs text-sm text-muted">
                Incidents appear here when a configured alert triggers.
              </p>
            </div>
          )}
          {query.data?.nextBefore && (
            <p className="mt-3 text-xs text-muted">
              Showing the latest 3 active incidents.
            </p>
          )}
        </Widget.Content>
      </Widget>
      {selected && (
        <ScoutIncidentDrawer
          serverId={selected.incident.serverId}
          incident={selected.incident}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}

export function OverviewScout({ servers }: { servers: Server[] }) {
  const query = useApiQuery<{
    activeIncidents: number;
    pressuredEntities: number;
  }>("/v1/core/monitoring/summary", 30_000);
  const { online, inactive, notReporting } = scoutCoverage(servers);
  return (
    <Widget className="min-w-0">
      <Widget.Header
        className="flex-wrap gap-2 py-2"
        endContent={
          <InlineLink href="/monitoring/performance" className="text-xs">
            View performance
          </InlineLink>
        }
      >
        <Widget.Title icon={<HugeiconsIcon icon={Activity01Icon} />}>
          Scout Agent
        </Widget.Title>
      </Widget.Header>
      <Widget.Content className="grid content-start gap-5">
        <div className="flex items-baseline gap-2">
          <span className="text-4xl font-semibold tabular-nums">{online}</span>
          <span className="text-sm text-muted">
            of {servers.length} servers reporting
          </span>
        </div>
        <div
          className="flex h-2 overflow-hidden rounded-full bg-surface-secondary"
          role="img"
          aria-label={`${online} online, ${notReporting} not reporting, ${inactive} inactive servers`}
        >
          {online > 0 && (
            <span
              className="bg-success"
              style={{ width: `${(online / servers.length) * 100}%` }}
            />
          )}
          {notReporting > 0 && (
            <span
              className="bg-warning"
              style={{ width: `${(notReporting / servers.length) * 100}%` }}
            />
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusBadge status="online" label={`${online} online`} />
          <StatusBadge
            status="warning"
            label={`${notReporting} not reporting`}
          />
          <StatusBadge status="inactive" label={`${inactive} inactive`} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-separator pt-4">
          {query.error ? (
            <QueryError message={query.error} />
          ) : !query.data ? (
            <QueryLoading />
          ) : (
            <InlineLink
              href="/monitoring/performance"
              className="inline-flex min-h-11 items-center gap-2"
            >
              <HugeiconsIcon
                icon={Activity01Icon}
                className="size-4 text-warning"
                aria-hidden="true"
              />
              <span>
                <strong className="tabular-nums">
                  {query.data.pressuredEntities}
                </strong>{" "}
                entities above 80% usage
              </span>
            </InlineLink>
          )}
          <InlineLink
            href="/servers"
            className="inline-flex min-h-11 items-center gap-2 text-xs"
          >
            <HugeiconsIcon
              icon={ServerStack01Icon}
              className="size-4"
              aria-hidden="true"
            />
            Manage servers
          </InlineLink>
        </div>
      </Widget.Content>
    </Widget>
  );
}

export function OverviewDeployments() {
  const query = useApiQuery<DeploymentHistoryPage>(
    "/v1/core/deployments/history?page=1&limit=3",
    5_000,
  );
  return (
    <Widget className="min-w-0">
      <Widget.Header
        className="flex-wrap gap-2 py-2"
        endContent={
          <InlineLink className="text-xs" href="/deployments">
            All deployments
          </InlineLink>
        }
      >
        <Widget.Title
          className="text-sm text-foreground"
          icon={<HugeiconsIcon icon={Rocket01Icon} />}
        >
          Recent deployments
        </Widget.Title>
      </Widget.Header>
      <Widget.Content className="grid content-start">
        {query.error ? (
          <QueryError message={query.error} />
        ) : !query.data ? (
          <QueryLoading />
        ) : query.data.deployments.length ? (
          <ul className="divide-y divide-separator">
            {query.data.deployments.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0 flex-1">
                  <InlineLink
                    className="break-words font-medium"
                    href={`/sources/${item.sourceId}/deployments/${item.id}`}
                  >
                    {item.deployableName}
                  </InlineLink>
                  <p className="mt-1 text-xs text-muted">
                    {item.environment === "production"
                      ? "Production"
                      : "Preview"}{" "}
                    · {item.commitSha.slice(0, 7)}
                  </p>
                </div>
                <div className="grid justify-items-end gap-2">
                  <StatusBadge status={item.state} />
                  <span className="text-xs text-muted">
                    <RelativeTime label="Requested" value={item.createdAt} />
                  </span>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-4 text-sm text-muted">
            Your latest deployments will appear here.
          </p>
        )}
      </Widget.Content>
    </Widget>
  );
}
