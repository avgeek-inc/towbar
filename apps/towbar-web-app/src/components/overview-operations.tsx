"use client";

import { deploymentSubtitle } from "@/lib/overview";
import Image from "next/image";
import { AlertCircleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type {
  App,
  DeploymentHistoryItem,
  DeploymentHistoryPage,
} from "@workspace/towbar-web-client";
import { TypographyCode } from "@workspace/web-design-system/typography/typography";
import { Widget } from "@workspace/web-design-system/data-display/widget";
import { StatusBadge } from "@workspace/towbar-web-ui/status-badge";
import {
  ResourceTable,
  type ResourceTableColumn,
} from "@workspace/towbar-web-ui/resource-table";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import { InlineLink } from "./page-parts";
import { RelativeTime } from "./last-synced-time";
import { useApiQuery } from "@/hooks/use-api-query";
import { getDeploymentDisplayStatus } from "@/lib/deployment-status";

export function OverviewIncidents() {
  const query = useApiQuery<{ activeIncidents: number }>(
    "/v1/core/monitoring/summary",
    30_000,
  );
  const count = query.data?.activeIncidents;
  return (
    <Widget className="min-w-0">
      <Widget.Header>
        <Widget.Title icon={<HugeiconsIcon icon={AlertCircleIcon} />}>
          Active incidents
        </Widget.Title>
      </Widget.Header>
      <Widget.Content className="flex min-h-40 items-center justify-between gap-4">
        {query.error ? (
          <QueryError message={query.error} />
        ) : count === undefined ? (
          <QueryLoading />
        ) : (
          <>
            <div className="grid justify-items-start gap-3">
              <InlineLink
                href="/monitoring/incidents"
                className="inline-flex min-h-11 min-w-11 items-center text-3xl font-semibold tracking-tight tabular-nums"
                aria-label={`${count} active ${count === 1 ? "incident" : "incidents"} — view all`}
              >
                {count}
              </InlineLink>
              <StatusBadge
                status={count ? "critical" : "healthy"}
                label={count ? "Needs attention" : "All clear"}
              />
            </div>
            <Image
              src={
                count
                  ? "/scout/mascot-soft-smoking.png"
                  : "/scout/mascot-soft-healthy.png"
              }
              alt=""
              width={160}
              height={120}
              className="h-24 w-32 shrink-0 object-contain sm:h-30 sm:w-40"
            />
          </>
        )}
      </Widget.Content>
    </Widget>
  );
}

function deploymentColumns(
  apps: App[],
): ResourceTableColumn<DeploymentHistoryItem>[] {
  return [
    {
      key: "deployment",
      header: "Recent deployments",
      className: "min-w-40",
      cell: (item) => {
        const detail = deploymentSubtitle(
          item,
          apps.find((app) => app.id === item.appId)?.config.domains?.primary,
        );
        return (
          <div className="grid gap-1">
            <span className="font-medium">{item.deployableName}</span>
            {detail && (
              <span
                className="max-w-48 truncate text-sm text-muted"
                title={detail}
              >
                {detail}
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: "environment",
      header: "Environment",
      className: "whitespace-nowrap",
      cell: (item) => <StatusBadge status={item.environment} />,
    },
    {
      key: "id",
      header: "ID",
      className: "whitespace-nowrap",
      cell: (item) => (
        <TypographyCode title={item.id}>{item.id.slice(0, 8)}</TypographyCode>
      ),
    },
    {
      key: "status",
      header: "Status",
      className: "whitespace-nowrap",
      cell: (item) => <StatusBadge status={getDeploymentDisplayStatus(item)} />,
    },
    {
      key: "requested",
      header: "Requested",
      className: "whitespace-nowrap",
      cell: (item) => <RelativeTime label="Requested" value={item.createdAt} />,
    },
  ];
}

export function OverviewDeployments({ apps }: { apps: App[] }) {
  const query = useApiQuery<DeploymentHistoryPage>(
    "/v1/core/deployments/history?page=1&limit=6",
    5_000,
  );
  return (
    <section aria-label="Recent deployments" className="min-w-0">
      {query.error ? (
        <QueryError message={query.error} />
      ) : !query.data ? (
        <QueryLoading variant="table" />
      ) : (
        <ResourceTable
          ariaLabel="Recent deployments"
          columns={deploymentColumns(apps)}
          items={query.data.deployments}
          getRowKey={(item) => item.id}
          getRowHref={(item) =>
            `/sources/${item.sourceId}/deployments/${item.id}`
          }
          emptyTitle="No deployments yet"
          emptyDescription="Your latest deployments will appear here."
        />
      )}
    </section>
  );
}
