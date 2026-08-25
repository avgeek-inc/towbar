"use client";

import type { Deployment } from "@workspace/towbar-web-client";
import { useTablePagination } from "@workspace/web-design-system/hooks/use-table-pagination";
import { Pagination } from "@workspace/web-design-system/navigation/pagination";
import { TypographyCode } from "@workspace/web-design-system/typography/typography";
import {
  ResourceTable,
  type ResourceTableColumn,
} from "@workspace/towbar-web-ui/resource-table";
import { StatusBadge } from "@workspace/towbar-web-ui/status-badge";

import { RelativeTime, RelativeTimeProvider } from "./last-synced-time";
import { getDeploymentDisplayStatus } from "@/lib/deployment-status";

const DEPLOYMENT_PAGE_SIZE = 10;

export function DeploymentTable({
  deployments,
  deployableName,
  emptyDescription,
}: {
  deployments: Deployment[];
  deployableName: string;
  emptyDescription: string;
}) {
  const orderedDeployments = [...deployments].sort(
    (left, right) =>
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );
  const pagination = useTablePagination({
    pageSize: DEPLOYMENT_PAGE_SIZE,
    total: orderedDeployments.length,
  });
  const visibleDeployments = orderedDeployments.slice(
    pagination.offset,
    pagination.offset + pagination.pageSize,
  );
  const columns: ResourceTableColumn<Deployment>[] = [
    {
      key: "commit",
      header: "Commit",
      cell: (deployment) => (
        <TypographyCode title={deployment.commitSha}>
          {deployment.commitSha.slice(0, 12)}
        </TypographyCode>
      ),
      className: "min-w-40",
    },
    {
      key: "trigger",
      header: "Trigger",
      cell: (deployment) => formatDeploymentTrigger(deployment.trigger),
      className: "hidden whitespace-nowrap sm:table-cell",
      headerClassName: "hidden sm:table-cell",
    },
    {
      key: "requested",
      header: "Requested",
      cell: (deployment) => (
        <RelativeTime label="Requested" value={deployment.createdAt} />
      ),
      className: "hidden whitespace-nowrap md:table-cell",
      headerClassName: "hidden md:table-cell",
    },
    {
      key: "duration",
      header: "Duration",
      cell: (deployment) => (
        <span className="whitespace-nowrap tabular-nums">
          {formatDeploymentDuration(deployment)}
        </span>
      ),
      className: "hidden md:table-cell",
      headerClassName: "hidden md:table-cell",
    },
    {
      key: "status",
      header: "Status",
      cell: (deployment) => (
        <StatusBadge status={getDeploymentDisplayStatus(deployment)} />
      ),
      className: "whitespace-nowrap",
    },
  ];

  return (
    <RelativeTimeProvider>
      <div className="grid gap-4">
        <ResourceTable
          ariaLabel={`${deployableName} deployments`}
          columns={columns}
          emptyDescription={emptyDescription}
          emptyTitle="No deployments yet"
          getRowHref={(deployment) =>
            `/sources/${deployment.sourceId}/deployments/${deployment.id}`
          }
          getRowKey={(deployment) => deployment.id}
          items={visibleDeployments}
        />
        {orderedDeployments.length > pagination.pageSize ? (
          <Pagination
            aria-label={`${deployableName} deployment pages`}
            page={pagination.page}
            size="sm"
            totalPages={pagination.totalPages ?? 1}
            onPageChange={pagination.setPage}
          />
        ) : null}
      </div>
    </RelativeTimeProvider>
  );
}

export function formatDeploymentTrigger(trigger: Deployment["trigger"]) {
  if (trigger === "auto_deploy") return "Auto-deploy";
  if (trigger === "rollback") return "Rollback";
  return "Manual";
}

function formatDeploymentDuration(deployment: Deployment) {
  if (!deployment.startedAt) return "—";
  const startedAt = new Date(deployment.startedAt).getTime();
  const finishedAt = deployment.finishedAt
    ? new Date(deployment.finishedAt).getTime()
    : Date.now();
  if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt)) return "—";

  const totalSeconds = Math.max(
    0,
    Math.floor((finishedAt - startedAt) / 1_000),
  );
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const totalMinutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (totalMinutes < 60) return `${totalMinutes}m ${seconds}s`;

  const totalHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (totalHours < 24) return `${totalHours}h ${minutes}m`;

  const days = Math.floor(totalHours / 24);
  return `${days}d ${totalHours % 24}h`;
}
