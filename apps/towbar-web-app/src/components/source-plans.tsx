"use client";

import { useRouter } from "next/navigation";

import type { DeploymentPlan } from "@workspace/towbar-web-client";
import { TypographyCode } from "@workspace/web-design-system/typography/typography";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import {
  ResourceTable,
  type ResourceTableColumn,
} from "@workspace/towbar-web-ui/resource-table";
import { StatusBadge } from "@workspace/towbar-web-ui/status-badge";

import { useApiQuery } from "@/hooks/use-api-query";
import { api } from "@/lib/api";
import { ActionButton } from "./page-parts";
import { formatDate } from "./dashboard-overview";

export function SourcePlans({ sourceId }: { sourceId: string }) {
  const router = useRouter();
  const query = useApiQuery<{ plans: DeploymentPlan[] }>(
    `/v1/core/sources/${sourceId}/plans`,
    5_000,
  );
  if (query.error) return <QueryError message={query.error} />;
  if (!query.data) return <QueryLoading />;
  const columns: ResourceTableColumn<DeploymentPlan>[] = [
    {
      key: "revision",
      header: "Target",
      cell: (plan) => (
        <span className="grid gap-0.5">
          <TypographyCode>{plan.targetCommitSha.slice(0, 12)}</TypographyCode>
          <span className="text-muted typography--body-xs font-normal">
            {plan.pullRequestNumber
              ? `PR #${plan.pullRequestNumber}`
              : plan.branch}
          </span>
        </span>
      ),
      className: "min-w-40",
    },
    {
      key: "trigger",
      header: "Trigger",
      cell: (plan) =>
        plan.trigger === "pull_request" ? "Pull request" : "Manual",
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
    <div className="grid gap-4">
      <div className="flex justify-end">
        <ActionButton
          action={() =>
            api.post<{ plan: DeploymentPlan }>(
              `/v1/core/sources/${sourceId}/actions/plan`,
            )
          }
          onSuccess={({ plan }) =>
            router.push(`/sources/${sourceId}/plans/${plan.id}`)
          }
          pendingLabel="Generating…"
          success="Deployment plan generated"
          variant="primary"
        >
          Generate plan
        </ActionButton>
      </div>
      <ResourceTable
        ariaLabel="Deployment plans"
        columns={columns}
        emptyAction={
          <ActionButton
            action={() =>
              api.post<{ plan: DeploymentPlan }>(
                `/v1/core/sources/${sourceId}/actions/plan`,
              )
            }
            onSuccess={({ plan }) =>
              router.push(`/sources/${sourceId}/plans/${plan.id}`)
            }
            pendingLabel="Generating…"
            success="Deployment plan generated"
          >
            Generate first plan
          </ActionButton>
        }
        emptyDescription="Generate a read-only comparison before changing this Source. Pull requests also publish their plan as one GitHub Check."
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
