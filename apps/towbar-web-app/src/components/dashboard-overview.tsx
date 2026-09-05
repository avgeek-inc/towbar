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
import { Chip } from "@workspace/web-design-system/data-display/chip";
import { EmptyState } from "@workspace/web-design-system/data-display/empty-state";
import { Widget } from "@workspace/web-design-system/data-display/widget";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";

import { DashboardPage } from "@/components/page-parts";
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
  const apps = useApiQuery<{ apps: App[] }>("/v1/core/apps");
  const resources = useApiQuery<{ resources: Resource[] }>(
    "/v1/core/resources",
  );
  const servers = useApiQuery<{ servers: Server[] }>("/v1/core/servers");
  const sources = useApiQuery<{ sources: Source[] }>("/v1/core/sources");
  const deployments = useApiQuery<{ deployments: Deployment[] }>(
    "/v1/core/deployments",
    5_000,
  );
  const error =
    apps.error ??
    resources.error ??
    servers.error ??
    sources.error ??
    deployments.error;
  if (error)
    return (
      <DashboardPage icon={DashboardSquare01Icon} title="Overview">
        <QueryError message={error} />
      </DashboardPage>
    );
  if (
    !apps.data ||
    !resources.data ||
    !servers.data ||
    !sources.data ||
    !deployments.data
  )
    return (
      <DashboardPage icon={DashboardSquare01Icon} title="Overview">
        <QueryLoading variant="dashboard" />
      </DashboardPage>
    );

  const appItems = apps.data.apps;
  const resourceItems = resources.data.resources;
  const serverItems = servers.data.servers;
  const sourceItems = sources.data.sources;
  const deploymentItems = deployments.data.deployments;
  const activeApps = appItems.filter((app) => !app.archivedAt);
  const activeResources = resourceItems.filter((item) => !item.archivedAt);
  const activeServers = serverItems.filter((server) => !server.archivedAt);
  const activeSources = sourceItems.filter(
    (source) => source.status === "active",
  );
  const unhealthyApps = activeApps.filter(isUnhealthy).length;
  const unhealthyResources = activeResources.filter(isUnhealthy).length;
  const unhealthyServerKeys = new Set(
    [...activeApps, ...activeResources]
      .filter(isUnhealthy)
      .map((item) => item.serverIp),
  );
  const unhealthyServers = activeServers.filter((server) =>
    unhealthyServerKeys.has(server.canonicalIp),
  ).length;
  const activity = buildDeploymentActivity(deploymentItems);
  const metrics = [
    {
      icon: GitBranchIcon,
      label: "Sources",
      unhealthyCount: null,
      value: activeSources.length,
    },
    {
      icon: DashboardCircleIcon,
      label: "Apps",
      unhealthyCount: unhealthyApps,
      value: activeApps.length,
    },
    {
      icon: DatabaseIcon,
      label: "Resources",
      unhealthyCount: unhealthyResources,
      value: activeResources.length,
    },
    {
      icon: ServerStack01Icon,
      label: "Servers",
      unhealthyCount: unhealthyServers,
      value: activeServers.length,
    },
  ];

  return (
    <DashboardPage icon={DashboardSquare01Icon} title="Overview">
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
                  {metric.value.toLocaleString()}
                </dd>
              </dl>
              {metric.unhealthyCount === null ? null : (
                <HealthChip unhealthyCount={metric.unhealthyCount} />
              )}
            </Widget.Content>
          </Widget>
        ))}
      </div>

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
            Deployment activity
          </Widget.Title>
        </Widget.Header>
        <Widget.Content className="grid min-w-0 gap-3">
          {deploymentItems.length ? (
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
                    labelFormatter={(value) =>
                      formatActivityDate(String(value))
                    }
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
    </DashboardPage>
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

function HealthChip({ unhealthyCount }: { unhealthyCount: number }) {
  return (
    <Chip variant={unhealthyCount ? "destructive" : "success"}>
      {unhealthyCount ? `${unhealthyCount} unhealthy` : "All healthy"}
    </Chip>
  );
}

function isUnhealthy(item: App | Resource) {
  return item.runtimeState.healthStatus === "unhealthy";
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
