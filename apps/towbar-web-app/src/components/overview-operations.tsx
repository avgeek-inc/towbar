"use client";

import {
  Activity01Icon,
  AlertCircleIcon,
  ServerStack01Icon,
  Rocket01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type {
  App,
  Resource,
  Server,
  DeploymentHistoryPage,
} from "@workspace/towbar-web-client";
import { Widget } from "@workspace/web-design-system/data-display/widget";
import { StatusBadge } from "@workspace/towbar-web-ui/status-badge";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import { InlineLink } from "./page-parts";
import { RelativeTime } from "./last-synced-time";
import { useApiQuery } from "@/hooks/use-api-query";
import { workloadAttention } from "@/lib/overview";

export function OverviewMonitoring() {
  const query = useApiQuery<{
    activeIncidents: number;
    pressuredEntities: number;
  }>("/v1/core/monitoring/summary", 30_000);
  if (query.error) return <QueryError message={query.error} />;
  if (!query.data)
    return (
      <div className="min-h-20">
        <QueryLoading />
      </div>
    );
  return (
    <div className="flex flex-wrap items-center gap-x-8 gap-y-3 py-2">
      <h2 className="text-sm font-medium">Right now</h2>
      <InlineLink
        href="/monitoring/incidents"
        className="inline-flex min-h-11 items-center gap-3"
      >
        <span
          className={query.data.activeIncidents ? "text-danger" : "text-muted"}
        >
          <HugeiconsIcon
            icon={AlertCircleIcon}
            className="size-5"
            aria-hidden="true"
          />
        </span>
        <span>
          <strong className="font-semibold tabular-nums">
            {query.data.activeIncidents}
          </strong>{" "}
          active {query.data.activeIncidents === 1 ? "incident" : "incidents"}
        </span>
      </InlineLink>
      <InlineLink
        href="/monitoring/performance"
        className="inline-flex min-h-11 items-center gap-3"
      >
        <span
          className={
            query.data.pressuredEntities ? "text-warning" : "text-muted"
          }
        >
          <HugeiconsIcon
            icon={Activity01Icon}
            className="size-5"
            aria-hidden="true"
          />
        </span>
        <span>
          <strong className="font-semibold tabular-nums">
            {query.data.pressuredEntities}
          </strong>{" "}
          entities above 80%
        </span>
      </InlineLink>
    </div>
  );
}

export function OverviewAttention({
  workloads,
}: {
  workloads: Array<App | Resource>;
}) {
  const attention = workloads
    .flatMap((item) => {
      const issue = workloadAttention(item);
      return issue ? [{ item, issue }] : [];
    })
    .sort(
      (a, b) =>
        Number(b.issue.status === "failed" || b.issue.status === "unhealthy") -
        Number(a.issue.status === "failed" || a.issue.status === "unhealthy"),
    );
  const unknown = workloads.filter(
    (item) =>
      item.runtimeState.observedState === "unknown" ||
      item.runtimeState.healthStatus === "unknown",
  ).length;
  return (
    <Widget className="min-w-0 overflow-visible rounded-none bg-transparent">
      <Widget.Header
        className="m-0 mb-4 flex-wrap gap-2 p-0"
        endContent={
          <span className="text-xs text-muted">
            {attention.length} workloads
          </span>
        }
      >
        <Widget.Title
          className="text-sm text-foreground"
          icon={<HugeiconsIcon icon={AlertCircleIcon} />}
        >
          Needs attention
        </Widget.Title>
      </Widget.Header>
      <Widget.Content className="m-0 grid content-start gap-0 rounded-none bg-transparent p-0 shadow-none">
        {attention.length ? (
          <ul className="divide-y divide-separator">
            {attention.slice(0, 5).map(({ item, issue }) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <InlineLink
                    className="break-words font-medium"
                    href={`/sources/${item.sourceId}/${item.kind === "app" ? "apps" : "resources"}/${item.id}`}
                  >
                    {item.name}
                  </InlineLink>
                  <p className="mt-1 text-xs text-muted">
                    {item.kind === "app" ? "App" : "Resource"} · {item.serverIp}
                  </p>
                </div>
                <StatusBadge status={issue.status} label={issue.label} />
              </li>
            ))}
          </ul>
        ) : (
          <div className="grid gap-2 py-4">
            <StatusBadge
              status="unknown"
              label={
                workloads.length
                  ? "No workload issues detected"
                  : "No workloads yet"
              }
            />
            <p className="text-sm text-muted">
              {workloads.length
                ? unknown
                  ? "Some workloads have not reported their runtime state."
                  : "Reported runtime and configuration states are clear."
                : "Connect a repository to import your apps and resources."}
            </p>
            {!workloads.length && (
              <InlineLink href="/sources">Open Sources</InlineLink>
            )}
          </div>
        )}
        {unknown > 0 && (
          <p className="mt-4 text-xs text-muted">
            Runtime or health is unknown for {unknown}{" "}
            {unknown === 1 ? "workload" : "workloads"}.
          </p>
        )}
        {attention.length > 5 && (
          <p className="mt-4 text-xs text-muted">
            Showing 5 of {attention.length}.{" "}
            <InlineLink href="/apps">Apps</InlineLink> ·{" "}
            <InlineLink href="/resources">Resources</InlineLink>
          </p>
        )}
      </Widget.Content>
    </Widget>
  );
}

export function OverviewDeployments() {
  const query = useApiQuery<DeploymentHistoryPage>(
    "/v1/core/deployments/history?page=1&limit=5",
    5_000,
  );
  return (
    <Widget className="min-w-0 overflow-visible rounded-none bg-transparent">
      <Widget.Header
        className="m-0 mb-4 flex-wrap gap-2 p-0"
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
      <Widget.Content className="m-0 rounded-none bg-transparent p-0 shadow-none">
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

export function OverviewServers({
  servers,
  workloads,
}: {
  servers: Server[];
  workloads: Array<App | Resource>;
}) {
  return (
    <Widget className="min-w-0 overflow-visible rounded-none bg-transparent">
      <Widget.Header
        className="m-0 mb-4 flex-wrap gap-2 p-0"
        endContent={
          <InlineLink className="text-xs" href="/servers">
            All servers
          </InlineLink>
        }
      >
        <Widget.Title
          className="text-sm text-foreground"
          icon={<HugeiconsIcon icon={ServerStack01Icon} />}
        >
          Server fleet
        </Widget.Title>
      </Widget.Header>
      <Widget.Content className="m-0 rounded-none bg-transparent p-0 shadow-none">
        {servers.length ? (
          <ul className="divide-y divide-separator">
            {servers.slice(0, 6).map((server) => {
              const scout = server.scout;
              return (
                <li
                  key={server.id}
                  className="grid gap-3 py-3 first:pt-0 last:pb-0 sm:grid-cols-[1fr_auto] sm:items-center"
                >
                  <div>
                    <InlineLink
                      className="font-medium"
                      href={`/servers/${server.id}`}
                    >
                      {server.canonicalIp}
                    </InlineLink>
                    <p className="mt-1 text-xs text-muted">
                      {
                        workloads.filter(
                          (item) => item.serverIp === server.canonicalIp,
                        ).length
                      }{" "}
                      workloads
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge
                      status={server.setupStatus}
                      label={`Setup: ${server.setupStatus}`}
                    />
                    <StatusBadge
                      status={scout?.enabled ? scout.status : "inactive"}
                      label={`Scout Agent: ${scout?.enabled ? scout.status.replaceAll("_", " ") : "inactive"}`}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="py-4 text-sm text-muted">
            Servers appear when you connect a Source with a deployment target.
          </p>
        )}
        {servers.length > 6 && (
          <p className="mt-3 text-xs text-muted">
            Showing 6 of {servers.length} servers.
          </p>
        )}
      </Widget.Content>
    </Widget>
  );
}
