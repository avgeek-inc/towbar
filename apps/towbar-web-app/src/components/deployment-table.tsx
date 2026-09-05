"use client";

import type { Deployment } from "@workspace/towbar-web-client";
import { Chip } from "@workspace/web-design-system/data-display/chip";
import { useTablePagination } from "@workspace/web-design-system/hooks/use-table-pagination";
import { Pagination } from "@workspace/web-design-system/navigation/pagination";
import { TypographyCode } from "@workspace/web-design-system/typography/typography";
import {
  ResourceTable,
  type ResourceTableColumn,
} from "@workspace/towbar-web-ui/resource-table";
import { StatusBadge } from "@workspace/towbar-web-ui/status-badge";

import { DeploymentDuration } from "./elapsed-time";
import { RelativeTime } from "./last-synced-time";
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
      cell: (deployment) => (
        <Chip size="small" variant="secondary">
          {formatDeploymentTrigger(deployment.trigger)}
        </Chip>
      ),
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
      cell: (deployment) => <DeploymentDuration deployment={deployment} />,
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
  );
}

export function formatDeploymentTrigger(trigger: Deployment["trigger"]) {
  if (trigger === "auto_deploy") return "Auto-deploy";
  if (trigger === "rollback") return "Rollback";
  return "Manual";
}
