"use client";

import {
  Activity01Icon,
  DashboardCircleIcon,
  DashboardSquare01Icon,
  DatabaseIcon,
  GitBranchIcon,
  ServerStack01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ComponentProps } from "react";
import type {
  App,
  Deployment,
  Resource,
  Server,
  Source,
} from "@workspace/towbar-web-client";
import { LineChart } from "@workspace/web-design-system/charts/line-chart";
import { ButtonLink } from "@workspace/web-design-system/buttons/button";
import { EmptyState } from "@workspace/web-design-system/data-display/empty-state";
import { Widget } from "@workspace/web-design-system/data-display/widget";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";

import { DashboardPage, InlineLink } from "@/components/page-parts";
import {
  OverviewMonitoring,
  OverviewAttention,
  OverviewDeployments,
  OverviewServers,
} from "./overview-operations";
import { useApiQuery } from "@/hooks/use-api-query";

const activitySeries = [
  { color: "var(--accent-soft-foreground)", key: "total", label: "Requested" },
  {
    color: "var(--success-soft-foreground)",
    key: "succeeded",
    label: "Succeeded",
  },
  { color: "var(--danger-soft-foreground)", key: "failed", label: "Failed" },
];
const activityAxisTick = { fill: "var(--muted)", fontSize: 12 } as const;

export function DashboardOverview() {
  const apps = useApiQuery<{ apps: App[] }>("/v1/core/apps", 30_000);
  const resources = useApiQuery<{ resources: Resource[] }>(
    "/v1/core/resources",
    30_000,
  );
  const servers = useApiQuery<{ servers: Server[] }>(
    "/v1/core/servers",
    30_000,
  );
  const sources = useApiQuery<{ sources: Source[] }>(
    "/v1/core/sources",
    30_000,
  );
  const error = apps.error ?? resources.error ?? servers.error ?? sources.error;
  if (error)
    return (
      <DashboardPage icon={DashboardSquare01Icon} title="Overview">
        <QueryError message={error} />
      </DashboardPage>
    );
  if (!apps.data || !resources.data || !servers.data || !sources.data)
    return (
      <DashboardPage icon={DashboardSquare01Icon} title="Overview">
        <QueryLoading variant="dashboard" />
      </DashboardPage>
    );

  const appItems = apps.data.apps;
  const resourceItems = resources.data.resources;
  const serverItems = servers.data.servers;
  const sourceItems = sources.data.sources;
  const activeApps = appItems.filter((app) => !app.archivedAt);
  const activeResources = resourceItems.filter((item) => !item.archivedAt);
  const activeServers = serverItems.filter((server) => !server.archivedAt);
  const activeSources = sourceItems.filter(
    (source) => source.status === "active",
  );
  const metrics = [
    {
      icon: GitBranchIcon,
      href: "/sources",
      label: "Sources",
      detail: `${activeSources.filter((source) => source.latestCommitSha).length} imported`,
      value: activeSources.length,
    },
    {
      icon: DashboardCircleIcon,
      href: "/apps",
      label: "Apps",
      detail: `${activeApps.filter((item) => item.runtimeState.observedState === "running").length} running`,
      value: activeApps.length,
    },
    {
      icon: DatabaseIcon,
      href: "/resources",
      label: "Resources",
      detail: `${activeResources.filter((item) => item.runtimeState.observedState === "running").length} running`,
      value: activeResources.length,
    },
    {
      icon: ServerStack01Icon,
      href: "/servers",
      label: "Servers",
      detail: `${activeServers.filter((server) => server.setupStatus === "ready").length} ready`,
      value: activeServers.length,
    },
  ];

  return (
    <DashboardPage
      icon={DashboardSquare01Icon}
      title="Overview"
      actions={
        <ButtonLink href="/sources" variant="secondary">
          <HugeiconsIcon
            icon={GitBranchIcon}
            className="size-4"
            aria-hidden="true"
          />
          Open Sources
        </ButtonLink>
      }
    >
      <div className="content-grid grid-cols-2 lg:grid-cols-4">
        {metrics.map((metric) => (
          <Widget className="min-w-0" key={metric.label}>
            <Widget.Header>
              <Widget.Title className="inline-flex items-center gap-2">
                <OverviewMetricIcon icon={metric.icon} />
                {metric.label}
              </Widget.Title>
            </Widget.Header>
            <Widget.Content className="flex flex-wrap items-end justify-between gap-3">
              <dl>
                <dt className="sr-only">{metric.label}</dt>
                <dd className="text-3xl font-semibold tracking-tight tabular-nums">
                  <InlineLink
                    aria-label={`${metric.value.toLocaleString()} ${metric.label.toLowerCase()} — view all`}
                    className="inline-flex min-h-11 min-w-11 items-center"
                    href={metric.href}
                  >
                    {metric.value.toLocaleString()}
                  </InlineLink>
                </dd>
              </dl>
              <span className="text-xs text-muted">{metric.detail}</span>
            </Widget.Content>
          </Widget>
        ))}
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="grid min-w-0 gap-4">
          <OverviewMonitoring />
          <OverviewAttention workloads={[...activeApps, ...activeResources]} />
          <OverviewServers
            servers={activeServers}
            workloads={[...activeApps, ...activeResources]}
          />
        </div>
        <OverviewDeployments />
      </div>
      <OverviewActivity />
    </DashboardPage>
  );
}

function OverviewActivity() {
  const query = useApiQuery<{ deployments: Deployment[] }>(
    "/v1/core/deployments",
    30_000,
  );
  const deploymentItems = query.data?.deployments ?? [];
  const activity = buildDeploymentActivity(deploymentItems);
  return (
    <Widget className="min-w-0">
      <Widget.Header
        className="flex-wrap py-2"
        endContent={
          deploymentItems.length ? (
            <Widget.Legend className="flex-wrap">
              {activitySeries.map((series) => (
                <Widget.LegendItem color={series.color} key={series.key}>
                  {series.label}
                </Widget.LegendItem>
              ))}
            </Widget.Legend>
          ) : null
        }
      >
        <Widget.Title icon={<HugeiconsIcon icon={Activity01Icon} />}>
          Production deployments · last 14 days
        </Widget.Title>
      </Widget.Header>
      <Widget.Content className="grid min-w-0 gap-3">
        {query.error ? (
          <QueryError message={query.error} />
        ) : !query.data ? (
          <QueryLoading />
        ) : deploymentItems.length ? (
          <LineChart
            aria-label="Deployment activity over the last 14 days"
            className="min-w-0"
            data={activity}
            height={236}
          >
            <LineChart.Grid vertical={false} />
            <LineChart.XAxis
              dataKey="date"
              tick={activityAxisTick}
              tickFormatter={(value) => formatActivityDate(String(value))}
              tickMargin={8}
            />
            <LineChart.YAxis tick={activityAxisTick} width={32} />
            {activitySeries.map((series) => (
              <LineChart.Line
                dataKey={series.key}
                dot={false}
                isAnimationActive={false}
                key={series.key}
                name={series.label}
                stroke={series.color}
                strokeWidth={2}
                type="monotone"
              />
            ))}
            <LineChart.Tooltip
              content={
                <LineChart.TooltipContent
                  labelFormatter={(value) => formatActivityDate(String(value))}
                />
              }
            />
          </LineChart>
        ) : (
          <EmptyState>
            <EmptyState.Header>
              <EmptyState.Title>No deployment activity yet</EmptyState.Title>
              <EmptyState.Description className="max-w-sm text-pretty">
                Add or open a Source, then deploy an imported app or resource
                when it is ready.
              </EmptyState.Description>
            </EmptyState.Header>
            <EmptyState.Content>
              <ButtonLink href="/sources" variant="secondary">
                Open Sources
              </ButtonLink>
            </EmptyState.Content>
          </EmptyState>
        )}
      </Widget.Content>
    </Widget>
  );
}

function OverviewMetricIcon({
  icon,
}: {
  icon: ComponentProps<typeof HugeiconsIcon>["icon"];
}) {
  return (
    <HugeiconsIcon aria-hidden="true" className="size-4 shrink-0" icon={icon} />
  );
}

function buildDeploymentActivity(deployments: Deployment[]) {
  const days = Array.from({ length: 14 }, (_, index) => {
    const date = new Date();
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() - (13 - index));
    return {
      date: date.toISOString().slice(0, 10),
      failed: 0,
      succeeded: 0,
      total: 0,
    };
  });
  const byDate = new Map(days.map((day) => [day.date, day] as const));
  for (const deployment of deployments) {
    const day = byDate.get(deployment.createdAt.slice(0, 10));
    if (!day) continue;
    day.total += 1;
    if (["succeeded", "succeeded_with_warnings"].includes(deployment.state))
      day.succeeded += 1;
    if (deployment.state === "failed") day.failed += 1;
  }
  return days;
}

function formatActivityDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
