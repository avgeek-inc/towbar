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
import Image from "next/image";
import type {
  App,
  Deployment,
  Resource,
  Server,
} from "@workspace/towbar-web-client";
import { LineChart } from "@workspace/web-design-system/charts/line-chart";
import { ButtonLink } from "@workspace/web-design-system/buttons/button";
import { StatusBadge } from "@workspace/towbar-web-ui/status-badge";
import { EmptyState } from "@workspace/web-design-system/data-display/empty-state";
import { Widget } from "@workspace/web-design-system/data-display/widget";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";

import { DashboardPage, InlineLink } from "@/components/page-parts";
import { OverviewIncidents, OverviewDeployments } from "./overview-operations";
import { useApiQuery } from "@/hooks/use-api-query";

import { buildDeploymentActivity } from "@/lib/overview";

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
  const error = apps.error ?? resources.error ?? servers.error;
  if (error)
    return (
      <DashboardPage icon={DashboardSquare01Icon} title="Overview">
        <QueryError message={error} />
      </DashboardPage>
    );
  if (!apps.data || !resources.data || !servers.data)
    return (
      <DashboardPage icon={DashboardSquare01Icon} title="Overview">
        <QueryLoading variant="dashboard" />
      </DashboardPage>
    );

  const appItems = apps.data.apps;
  const resourceItems = resources.data.resources;
  const serverItems = servers.data.servers;
  const activeApps = appItems.filter((app) => !app.archivedAt);
  const activeResources = resourceItems.filter((item) => !item.archivedAt);
  const activeServers = serverItems.filter((server) => !server.archivedAt);
  const metrics = [
    {
      icon: DashboardCircleIcon,
      href: "/apps",
      label: "Apps",
      image: "/scout/overview-apps-trimmed.png",
      status: "running",
      detailCount: activeApps.filter(
        (item) => item.runtimeState.observedState === "running",
      ).length,
      detailLabel: "running",
      value: activeApps.length,
    },
    {
      icon: DatabaseIcon,
      href: "/resources",
      label: "Resources",
      image: "/scout/overview-resources-trimmed.png",
      status: "running",
      detailCount: activeResources.filter(
        (item) => item.runtimeState.observedState === "running",
      ).length,
      detailLabel: "running",
      value: activeResources.length,
    },
    {
      icon: ServerStack01Icon,
      href: "/servers",
      label: "Servers",
      image: "/scout/overview-servers-trimmed.png",
      status: "ready",
      detailCount: activeServers.filter(
        (server) => server.setupStatus === "ready",
      ).length,
      detailLabel: "ready",
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
      <div className="grid items-stretch gap-4 xl:grid-cols-2">
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          {metrics.map((metric) => (
            <Widget className="min-w-0" key={metric.label}>
              <Widget.Header>
                <Widget.Title icon={<OverviewMetricIcon icon={metric.icon} />}>
                  {metric.label}
                </Widget.Title>
              </Widget.Header>
              <Widget.Content className="flex min-h-30 items-center justify-between gap-3">
                <div className="grid justify-items-start gap-3">
                  <InlineLink
                    href={metric.href}
                    className="inline-flex min-h-11 min-w-11 items-center text-3xl font-semibold tracking-tight tabular-nums"
                    aria-label={`${metric.value} ${metric.label.toLowerCase()} — view all`}
                  >
                    {metric.value}
                  </InlineLink>
                  <StatusBadge
                    context="runtime"
                    status={metric.detailCount ? metric.status : "inactive"}
                    label={`${metric.detailCount} ${metric.detailLabel}`}
                  />
                </div>
                <Image
                  src={metric.image}
                  alt=""
                  width={128}
                  height={96}
                  className={
                    metric.label === "Servers"
                      ? "h-20 w-28 shrink-0 object-contain p-2"
                      : "h-24 w-28 shrink-0 object-contain"
                  }
                />
              </Widget.Content>
            </Widget>
          ))}
          <OverviewIncidents />
        </div>
        <OverviewActivity />
      </div>
      <OverviewDeployments apps={appItems} />
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
        className="flex-wrap gap-3"
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
          Production deployments · last 7 days
        </Widget.Title>
      </Widget.Header>
      <Widget.Content className="grid min-w-0 content-center gap-3">
        {query.error ? (
          <QueryError message={query.error} />
        ) : !query.data ? (
          <QueryLoading />
        ) : deploymentItems.length ? (
          <LineChart
            aria-label="Deployment activity over the last 7 days"
            className="min-w-0"
            data={activity}
            height={240}
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
