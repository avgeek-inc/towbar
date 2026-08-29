"use client";

import type { DeploymentPlan } from "@workspace/towbar-web-client";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import {
  ResourceTable,
  type ResourceTableColumn,
} from "@workspace/towbar-web-ui/resource-table";
import { StatusBadge } from "@workspace/towbar-web-ui/status-badge";

import { useApiQuery } from "@/hooks/use-api-query";
import { formatDate } from "./dashboard-overview";

export function SourcePlans({ sourceId }: { sourceId: string }) {
  const query = useApiQuery<{ plans: DeploymentPlan[] }>(
    `/v1/core/sources/${sourceId}/plans`,
    5_000,
  );
  if (query.error) return <QueryError message={query.error} />;
  if (!query.data) return <QueryLoading />;
  const columns: ResourceTableColumn<DeploymentPlan>[] = [
    {
      key: "pull-request",
      header: "Pull request",
      cell: (plan) =>
        plan.pullRequestNumber ? `PR #${plan.pullRequestNumber}` : "—",
      className: "min-w-36",
    },
    {
      key: "changes",
      header: "Changes",
      cell: (plan) => summarizeChanges(plan),
      className: "min-w-52",
    },
    {
      key: "status",
      header: "Status",
      cell: (plan) => <StatusBadge status={plan.status} />,
    },
    {
      key: "created",
      header: "Created",
      cell: (plan) => formatDate(plan.createdAt),
      className: "whitespace-nowrap",
    },
  ];
  return (
    <div>
      <ResourceTable
        ariaLabel="Deployment plans"
        columns={columns}
        emptyDescription="Deployment-relevant pull requests publish a GitHub Check linked to their plan in Towbar."
        emptyTitle="No deployment plans"
        getRowHref={(plan) => `/sources/${sourceId}/plans/${plan.id}`}
        getRowKey={(plan) => plan.id}
        items={query.data.plans}
      />
    </div>
  );
}

function summarizeChanges(plan: DeploymentPlan) {
  const summary = plan.plan.summary;
  const changes = [
    summary.create ? `${summary.create} create` : null,
    summary.update ? `${summary.update} update` : null,
    summary.restore ? `${summary.restore} restore` : null,
    summary.archive ? `${summary.archive} archive` : null,
    summary.no_op ? `${summary.no_op} no-op` : null,
  ].filter(Boolean);
  return changes.length > 0 ? changes.join(" · ") : "No relevant changes";
}
