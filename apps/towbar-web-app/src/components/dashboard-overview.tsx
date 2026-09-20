"use client";

import {
  displayChartDate,
  displayDate,
  displayDateTime,
} from "@/lib/date-time-display";
import { useLocalizedTimestamps } from "@/hooks/use-localized-timestamps";

import { groupDeployableInstances } from "@/lib/deployable-groups";
import {
  Activity01Icon,
  DashboardCircleIcon,
  DashboardSquare01Icon,
  CubeIcon,
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
import {
  ResourceTable,
  type ResourceTableColumn,
} from "@workspace/towbar-web-ui/resource-table";
import { EmptyState } from "@workspace/web-design-system/data-display/empty-state";
import { Widget } from "@workspace/web-design-system/data-display/widget";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";

import { DashboardPage, InlineLink } from "@/components/page-parts";
import { OverviewIncidents, OverviewDeployments } from "./overview-operations";
import { useApiQuery } from "@/hooks/use-api-query";

import { buildDeploymentActivity } from "@/lib/overview";
import { ServerIpLink } from "./source-inventory";

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
  const serversNeedingSetup = activeServers.filter(
    (server) => server.setupStatus !== "ready",
  );
  const pendingServerColumns: ResourceTableColumn<Server>[] = [
    {
      key: "server",
      header: "Server",
      cell: (server) => (
        <ServerIpLink
          hardware={server.hardware}
          ip={server.canonicalIp}
          serverId={server.id}
        />
      ),
      className: "w-full min-w-64",
    },
    {
      key: "status",
      header: "Setup",
      cell: (server) => <StatusBadge status={server.setupStatus} />,
      className: "whitespace-nowrap",
    },
    {
      key: "actions",
      header: "Actions",
      headerClassName: "text-end",
      cell: (server) => (
        <ButtonLink href={`/servers/${server.id}/overview`} variant="secondary">
          Complete Setup
        </ButtonLink>
      ),
      className: "whitespace-nowrap text-end",
    },
  ];
  const metrics = [
    {
      icon: DashboardCircleIcon,
      href: "/apps",
      label: "Apps",
      image: "/scout/overview-apps-charcoal.png",
      status: "running",
      detailCount: activeApps.filter(
        (item) => item.runtimeState.observedState === "running",
      ).length,
      detailLabel: "instances running",
      value: groupDeployableInstances(activeApps).length,
    },
    {
      icon: CubeIcon,
      href: "/resources",
      label: "Resources",
      image: "/scout/overview-resources-charcoal.png",
      status: "running",
      detailCount: activeResources.filter(
        (item) => item.runtimeState.observedState === "running",
      ).length,
      detailLabel: "instances running",
      value: groupDeployableInstances(activeResources).length,
    },
    {
      icon: ServerStack01Icon,
      href: "/servers",
      label: "Servers",
      image: "/scout/overview-servers-charcoal.png",
      status: "ready",
      detailCount: activeServers.filter(
        (server) => server.setupStatus === "ready",
      ).length,
      detailLabel: "ready",
      value: activeServers.length,
    },
  ];

  return (
    <DashboardPage icon={DashboardSquare01Icon} title="Overview">
      {serversNeedingSetup.length ? (
        <ResourceTable
          ariaLabel="Servers pending setup"
          columns={pendingServerColumns}
          emptyDescription="All servers are ready."
          emptyTitle="No servers pending setup"
          getRowKey={(server) => server.id}
          items={serversNeedingSetup}
          tableClassName="min-w-[560px]"
        />
      ) : null}
      <div className="grid items-stretch gap-4 xl:grid-cols-2">
        <OverviewActivity />
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          {metrics.map((metric) => (
            <Widget className="min-w-0" key={metric.label}>
              <Widget.Header>
                <Widget.Title icon={<OverviewMetricIcon icon={metric.icon} />}>
                  {metric.label}
                </Widget.Title>
              </Widget.Header>
              <Widget.Content className="relative flex min-h-30 items-center overflow-hidden pr-28">
                <div className="grid justify-items-start gap-3">
                  <InlineLink
                    href={metric.href}
                    className="inline-flex min-h-11 min-w-11 items-center text-3xl font-semibold tracking-tight font-mono tabular-nums"
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
                  width={512}
                  height={512}
                  className="pointer-events-none absolute right-0 bottom-0 h-28 w-28 object-contain object-right-bottom"
                />
              </Widget.Content>
            </Widget>
          ))}
          <OverviewIncidents />
        </div>
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
  const { error: dateLabelError } = useLocalizedTimestamps(
    activity.map((day) => day.date),
  );
  const activitySummary = summarizeDeploymentActivity(deploymentItems);
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
          Deployments trend
        </Widget.Title>
      </Widget.Header>
      <Widget.Content className="grid min-w-0 content-center gap-3">
        {query.error || dateLabelError ? (
          <QueryError message={query.error ?? dateLabelError!} />
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
              tickFormatter={(value) => displayChartDate(String(value))}
              tickMargin={8}
            />
            <LineChart.YAxis
              allowDecimals={false}
              tick={activityAxisTick}
              width={32}
            />
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
                Add or open a Repository, then deploy an imported app or
                resource when it is ready.
              </EmptyState.Description>
            </EmptyState.Header>
          </EmptyState>
        )}
      </Widget.Content>
      {activitySummary ? (
        <Widget.Footer>
          <Widget.FooterDescription className="tabular-nums">
            Last 7 days: {activitySummary.successRate}% successful ·{" "}
            {activitySummary.failed} failed · median duration{" "}
            {activitySummary.medianDuration}
          </Widget.FooterDescription>
        </Widget.Footer>
      ) : null}
    </Widget>
  );
}

function summarizeDeploymentActivity(deployments: Deployment[]) {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const completed = deployments.filter(
    (deployment) =>
      new Date(deployment.createdAt).getTime() >= cutoff &&
      deployment.finishedAt &&
      ["succeeded", "succeeded_with_warnings", "failed"].includes(
        deployment.state,
      ),
  );
  if (!completed.length) return null;
  const succeeded = completed.filter((deployment) =>
    deployment.state.startsWith("succeeded"),
  ).length;
  const durations = completed
    .filter((deployment) => deployment.startedAt && deployment.finishedAt)
    .map(
      (deployment) =>
        new Date(deployment.finishedAt!).getTime() -
        new Date(deployment.startedAt!).getTime(),
    )
    .filter((duration) => duration >= 0)
    .sort((left, right) => left - right);
  const median = durations[Math.floor(durations.length / 2)];
  return {
    failed: completed.filter((deployment) => deployment.state === "failed")
      .length,
    medianDuration:
      median === undefined
        ? "unavailable"
        : median < 60_000
          ? `${Math.max(1, Math.round(median / 1000))} sec`
          : `${Math.round(median / 60_000)} min`,
    successRate: Math.round((succeeded / completed.length) * 100),
  };
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
  return displayDate(value);
}

export function formatDate(value: string) {
  return displayDateTime(value);
}
