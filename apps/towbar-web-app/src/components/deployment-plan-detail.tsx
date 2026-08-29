"use client";

import { ValidationIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useParams } from "next/navigation";

import type { DeploymentPlan } from "@workspace/towbar-web-client";
import { Attributes } from "@workspace/web-design-system/data-display/attributes";
import { TypographyCode } from "@workspace/web-design-system/typography/typography";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import {
  ResourceTable,
  ResourceName,
  type ResourceTableColumn,
} from "@workspace/towbar-web-ui/resource-table";
import {
  formatStatus,
  StatusBadge,
} from "@workspace/towbar-web-ui/status-badge";

import { DashboardPage } from "@/components/page-parts";
import { useApiQuery } from "@/hooks/use-api-query";
import { formatDate } from "./dashboard-overview";
import { useSourceBreadcrumbs } from "./source-breadcrumbs";

type PlanItem = DeploymentPlan["plan"]["items"][number];
type PlanCheck = DeploymentPlan["plan"]["checks"][number];

export function DeploymentPlanDetail() {
  const { planId, sourceId } = useParams<{
    planId: string;
    sourceId: string;
  }>();
  const breadcrumbs = useSourceBreadcrumbs(sourceId, {
    href: `/sources/${sourceId}?section=plans`,
    label: "Plans",
  });
  const query = useApiQuery<{ plan: DeploymentPlan }>(
    `/v1/core/sources/${sourceId}/plans/${planId}`,
  );
  if (query.error) {
    return (
      <DashboardPage breadcrumbAncestors={breadcrumbs} title="Deployment plan">
        <QueryError message={query.error} />
      </DashboardPage>
    );
  }
  if (!query.data) {
    return (
      <DashboardPage breadcrumbAncestors={breadcrumbs} title="Deployment plan">
        <QueryLoading />
      </DashboardPage>
    );
  }

  const plan = query.data.plan;
  const itemColumns: ResourceTableColumn<PlanItem>[] = [
    {
      key: "entity",
      header: "Planned change",
      cell: (item) => (
        <ResourceName
          description={`${formatStatus(item.entityKind)} · ${item.entityId}`}
          name={item.name}
        />
      ),
      className: "min-w-56",
    },
    {
      key: "action",
      header: "Action",
      cell: (item) => <StatusBadge status={item.action} />,
    },
    {
      key: "reason",
      header: "Reason",
      cell: (item) => item.reasons.join(" · ") || "No material change",
      className: "min-w-72",
    },
    {
      key: "fields",
      header: "Changed fields",
      cell: (item) =>
        item.changedFields.length > 0 ? (
          <span className="flex max-w-xl flex-wrap gap-1">
            {item.changedFields.map((field) => (
              <TypographyCode key={field}>{field}</TypographyCode>
            ))}
          </span>
        ) : (
          "—"
        ),
      className: "min-w-56",
    },
    {
      key: "paths",
      header: "Matched paths",
      cell: (item) => item.matchedPaths.join(", ") || "—",
      className: "min-w-56",
    },
  ];
  const checkColumns: ResourceTableColumn<PlanCheck>[] = [
    {
      key: "check",
      header: "Validation",
      cell: (check) => (
        <ResourceName description={check.code} name={check.message} />
      ),
      className: "min-w-72",
    },
    {
      key: "status",
      header: "Result",
      cell: (check) => <StatusBadge status={check.status} />,
    },
    {
      key: "scope",
      header: "Scope",
      cell: (check) =>
        [check.entityKind, check.entityId].filter(Boolean).join(" · ") ||
        "Source",
      className: "min-w-44",
    },
    {
      key: "references",
      header: "References",
      cell: (check) => check.references?.join(", ") || "—",
      className: "min-w-56",
    },
  ];

  return (
    <DashboardPage
      badge={<StatusBadge status={plan.status} />}
      breadcrumbAncestors={breadcrumbs}
      breadcrumbLabel={`Plan ${plan.id.slice(0, 8)}`}
      title={`Deployment plan ${plan.id.slice(0, 8)}`}
      titleContent={
        <span className="inline-flex min-w-0 items-center gap-2">
          <HugeiconsIcon
            aria-hidden="true"
            className="size-6 shrink-0"
            icon={ValidationIcon}
          />
          <span>Deployment plan</span>
          <TypographyCode title={plan.id}>{plan.id.slice(0, 8)}</TypographyCode>
        </span>
      }
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <Attributes columns={2} title="Comparison" variant="card">
          <Attributes.Item label="Trigger">
            {plan.trigger === "pull_request" ? "Pull request" : "Manual"}
          </Attributes.Item>
          <Attributes.Item label="Pull request">
            {plan.pullRequestNumber ? `#${plan.pullRequestNumber}` : "—"}
          </Attributes.Item>
          <Attributes.Item label="Current commit">
            {plan.currentCommitSha ? (
              <TypographyCode title={plan.currentCommitSha}>
                {plan.currentCommitSha.slice(0, 12)}
              </TypographyCode>
            ) : (
              "None"
            )}
          </Attributes.Item>
          <Attributes.Item label="Target commit">
            <TypographyCode title={plan.targetCommitSha}>
              {plan.targetCommitSha.slice(0, 12)}
            </TypographyCode>
          </Attributes.Item>
          <Attributes.Item label="Branch">{plan.branch}</Attributes.Item>
          <Attributes.Item label="Created">
            {formatDate(plan.createdAt)}
          </Attributes.Item>
        </Attributes>
        <Attributes columns={2} title="Manifest identity" variant="card">
          <Attributes.Item label="Current digest">
            {plan.currentManifestDigest ? (
              <TypographyCode title={plan.currentManifestDigest}>
                {plan.currentManifestDigest.slice(0, 12)}
              </TypographyCode>
            ) : (
              "None"
            )}
          </Attributes.Item>
          <Attributes.Item label="Target digest">
            {plan.targetManifestDigest ? (
              <TypographyCode title={plan.targetManifestDigest}>
                {plan.targetManifestDigest.slice(0, 12)}
              </TypographyCode>
            ) : (
              "Unavailable"
            )}
          </Attributes.Item>
          <Attributes.Item label="GitHub Check">
            {plan.trigger === "pull_request" ? (
              <span className="grid gap-1">
                <StatusBadge status={plan.githubCheckStatus ?? "pending"} />
                {plan.githubCheckError ? (
                  <span className="text-muted typography--body-xs">
                    {plan.githubCheckError}
                  </span>
                ) : null}
              </span>
            ) : (
              "Not applicable"
            )}
          </Attributes.Item>
          <Attributes.Item label="Plan ID">
            <TypographyCode>{plan.id}</TypographyCode>
          </Attributes.Item>
        </Attributes>
      </div>
      <ResourceTable
        ariaLabel="Deployment plan validation"
        columns={checkColumns}
        emptyDescription="This comparison did not require additional validation checks."
        emptyTitle="No validation checks"
        getRowKey={(check) =>
          [check.code, check.entityKind, check.entityId]
            .filter(Boolean)
            .join(":")
        }
        items={plan.plan.checks}
      />
      <ResourceTable
        ariaLabel="Planned deployment changes"
        columns={itemColumns}
        emptyDescription="No app, resource, or server matched the pull request change patterns."
        emptyTitle="No deployment-relevant changes"
        getRowKey={(item) => `${item.entityKind}:${item.entityId}`}
        items={plan.plan.items}
      />
    </DashboardPage>
  );
}
