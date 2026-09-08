"use client";

import Image from "next/image";
import { AlertCircleIcon, Rocket01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type {
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
                count ? "/scout/mascot-worried.png" : "/scout/mascot-all-ok.png"
              }
              alt=""
              width={160}
              height={160}
              className="size-32 shrink-0 object-contain sm:size-40"
            />
          </>
        )}
      </Widget.Content>
    </Widget>
  );
}

const columns: ResourceTableColumn<DeploymentHistoryItem>[] = [
  {
    key: "deployment",
    header: "Deployment",
    className: "min-w-44",
    cell: (item) => (
      <div className="grid gap-2">
        <span className="font-medium">{item.deployableName}</span>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={item.environment} />
          <TypographyCode title={item.commitSha}>
            {item.commitSha.slice(0, 7)}
          </TypographyCode>
        </div>
      </div>
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

export function OverviewDeployments() {
  const query = useApiQuery<DeploymentHistoryPage>(
    "/v1/core/deployments/history?page=1&limit=6",
    5_000,
  );
  return (
    <section
      aria-labelledby="overview-deployments"
      className="grid min-w-0 content-start gap-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2
          id="overview-deployments"
          className="inline-flex items-center gap-2 text-sm font-medium"
        >
          <HugeiconsIcon
            icon={Rocket01Icon}
            className="size-4"
            aria-hidden="true"
          />
          Recent deployments
        </h2>
        <InlineLink className="text-sm" href="/deployments">
          All deployments
        </InlineLink>
      </div>
      {query.error ? (
        <QueryError message={query.error} />
      ) : !query.data ? (
        <QueryLoading variant="table" />
      ) : (
        <ResourceTable
          ariaLabel="Recent deployments"
          columns={columns}
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
