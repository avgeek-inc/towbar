"use client";

import {
  DashboardCircleIcon,
  DatabaseIcon,
  Rocket01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect } from "react";
import type {
  DeploymentHistoryItem,
  DeploymentHistoryPage,
} from "@workspace/towbar-web-client";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import {
  ResourceTable,
  type ResourceTableColumn,
} from "@workspace/towbar-web-ui/resource-table";
import { StatusBadge } from "@workspace/towbar-web-ui/status-badge";
import { Chip } from "@workspace/web-design-system/data-display/chip";
import { useTablePagination } from "@workspace/web-design-system/hooks/use-table-pagination";
import { Pagination } from "@workspace/web-design-system/navigation/pagination";
import { TypographyCode } from "@workspace/web-design-system/typography/typography";

import { DashboardPage, InlineLink } from "@/components/page-parts";
import { useApiQuery } from "@/hooks/use-api-query";
import { getDeploymentDisplayStatus } from "@/lib/deployment-status";
import {
  formatDeploymentDuration,
  formatDeploymentTrigger,
} from "./deployment-table";
import { RelativeTime } from "./last-synced-time";

const columns: ResourceTableColumn<DeploymentHistoryItem>[] = [
  {
    key: "id",
    header: "Deployment ID",
    cell: (item) => (
      <TypographyCode title={item.id}>{item.id.slice(0, 8)}</TypographyCode>
    ),
    className: "min-w-40",
  },
  {
    key: "deployable",
    header: "App / Resource",
    cell: (item) => (
      <span className="inline-flex items-center gap-2">
        <InlineLink
          className="inline-flex items-center gap-2"
          href={`/sources/${item.sourceId}/${item.deployableKind === "app" ? "apps" : "resources"}/${item.appId}`}
        >
          <HugeiconsIcon
            aria-hidden="true"
            className="size-4 shrink-0"
            icon={
              item.deployableKind === "app" ? DashboardCircleIcon : DatabaseIcon
            }
          />
          {item.deployableName}
        </InlineLink>
        {item.environment === "preview" ? (
          <Chip size="small" variant="secondary">
            Preview
          </Chip>
        ) : null}
      </span>
    ),
    className: "min-w-56",
  },
  {
    key: "trigger",
    header: "Trigger",
    cell: (item) => (
      <Chip size="small" variant="secondary">
        {formatDeploymentTrigger(item.trigger)}
      </Chip>
    ),
    className: "whitespace-nowrap",
  },
  {
    key: "requested",
    header: "Requested",
    cell: (item) => <RelativeTime label="Requested" value={item.createdAt} />,
    className: "min-w-40 whitespace-nowrap",
  },
  {
    key: "duration",
    header: "Duration",
    cell: (item) => (
      <span className="whitespace-nowrap tabular-nums">
        {formatDeploymentDuration(item)}
      </span>
    ),
  },
  {
    key: "status",
    header: "Status",
    cell: (item) => <StatusBadge status={getDeploymentDisplayStatus(item)} />,
    className: "whitespace-nowrap",
  },
];

export function DeploymentsIndex() {
  const pagination = useTablePagination({ pageSize: 10 });
  const query = useApiQuery<DeploymentHistoryPage>(
    `/v1/core/deployments/history?page=${pagination.page}&limit=${pagination.pageSize}`,
    5_000,
  );
  const { setTotal, reset } = pagination;
  useEffect(() => {
    if (!query.data) return;
    setTotal(query.data.pagination.total);
    if (!query.data.pagination.total) reset();
  }, [query.data, reset, setTotal]);

  return (
    <DashboardPage icon={Rocket01Icon} title="Deployments">
      <div className="grid gap-4">
        {query.error ? (
          <QueryError message={query.error} />
        ) : !query.data ? (
          <QueryLoading variant="table" />
        ) : (
          <ResourceTable
            ariaLabel="All deployments"
            columns={columns}
            emptyTitle="No deployments yet"
            emptyDescription="Deploy an app or resource to see its deployment history here."
            getRowHref={(item) =>
              `/sources/${item.sourceId}/deployments/${item.id}`
            }
            getRowKey={(item) => item.id}
            items={query.data.deployments}
            tableClassName="min-w-[1040px]"
          />
        )}
        {(pagination.totalPages ?? 0) > 1 ? (
          <Pagination
            aria-label="Deployment pages"
            page={pagination.page}
            size="sm"
            totalPages={pagination.totalPages ?? 1}
            onPageChange={pagination.setPage}
          />
        ) : null}
      </div>
    </DashboardPage>
  );
}
