"use client";

import {
  TableCellStack,
  TableCellDescription,
  tableCellDescriptionClassName,
} from "@workspace/towbar-web-ui/table-cell-text";

import { HugeiconsIcon } from "@hugeicons/react";
import {
  Delete02Icon,
  GitBranchIcon,
  ReloadIcon,
} from "@hugeicons/core-free-icons";

import { TooltipText } from "@workspace/web-design-system/overlays/tooltip";
import { NewTabIndicator } from "@workspace/web-design-system/navigation/new-tab-indicator";

import type { PreviewEnvironment } from "@workspace/towbar-web-client";
import { TypographyCode } from "@workspace/web-design-system/typography/typography";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import {
  ResourceTable,
  type ResourceTableColumn,
} from "@workspace/towbar-web-ui/resource-table";
import { StatusBadge } from "@workspace/towbar-web-ui/status-badge";

import { ActionButton, InlineLink } from "@/components/page-parts";
import { useApiQuery } from "@/hooks/use-api-query";
import { api } from "@/lib/api";
import { deploymentHref } from "@/lib/deployment-route";
import { RelativeTime } from "./last-synced-time";
import { formatDate } from "./dashboard-overview";
import { DomainLink } from "./domain-link";

export function PreviewEnvironments({
  appId,
  sourceId,
}: {
  appId?: string;
  sourceId: string;
}) {
  const endpoint = appId
    ? `/v1/core/apps/${appId}/previews`
    : `/v1/core/sources/${sourceId}/previews`;
  const query = useApiQuery<{ previews: PreviewEnvironment[] }>(
    endpoint,
    5_000,
  );
  if (query.error) return <QueryError message={query.error} />;
  if (!query.data) return <QueryLoading variant="list" />;

  const columns: ResourceTableColumn<PreviewEnvironment>[] = [
    {
      key: "pull-request",
      header: "Pull request",
      className: "min-w-48",
      cell: (preview) => (
        <TableCellStack as="div" className="justify-items-start">
          <a
            className="focus-visible:ring-focus rounded-md underline decoration-muted underline-offset-4 outline-none hover:decoration-current focus-visible:ring-2"
            href={preview.pullRequestUrl}
            rel="noreferrer"
            target="_blank"
          >
            PR #{preview.pullRequestNumber}
            <NewTabIndicator />
          </a>
          <TooltipText
            className={`${tableCellDescriptionClassName} inline-flex max-w-48 items-center gap-1 truncate`}
            tooltip={preview.branch}
          >
            <HugeiconsIcon
              aria-hidden="true"
              icon={GitBranchIcon}
              className="size-[1em] shrink-0"
            />
            <TypographyCode className="truncate py-0 text-xs/4">
              {preview.branch}
            </TypographyCode>
          </TooltipText>
        </TableCellStack>
      ),
    },
    ...(!appId
      ? [
          {
            key: "app",
            header: "App",
            className: "min-w-44",
            cell: (preview: PreviewEnvironment) => preview.appName,
          },
        ]
      : []),
    {
      key: "url",
      header: "URL",
      className: "min-w-64",
      cell: (preview) => (
        <DomainLink domain={preview.hostname}>{preview.hostname}</DomainLink>
      ),
    },
    {
      key: "commit",
      header: "Commit",
      className: "whitespace-nowrap",
      cell: (preview) => (
        <TypographyCode title={preview.latestCommitSha}>
          {preview.latestCommitSha.slice(0, 12)}
        </TypographyCode>
      ),
    },
    {
      key: "expires",
      header: "Expires",
      className: "min-w-48 whitespace-nowrap",
      cell: (preview) => (
        <RelativeTime label="Expires" value={preview.expiresAt} />
      ),
    },
    {
      key: "status",
      header: "Status",
      className: "min-w-56",
      cell: (preview) => (
        <TableCellStack as="div" className="justify-items-start">
          <StatusBadge
            status={preview.status}
            tooltip={
              preview.status === "cleanup_failed" && preview.errorMessage
                ? preview.errorMessage
                : undefined
            }
          />
          {preview.status === "cleanup_failed" &&
          preview.nextCleanupAttemptAt ? (
            <TableCellDescription className="whitespace-nowrap tabular-nums">
              Retry scheduled {formatDate(preview.nextCleanupAttemptAt)}
            </TableCellDescription>
          ) : null}
        </TableCellStack>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      className: "whitespace-nowrap",
      cell: (preview) => (
        <div className="flex items-center gap-2">
          {preview.latestDeploymentId ? (
            <InlineLink
              href={deploymentHref({
                appId: preview.appId,
                deployableKind: "app",
                id: preview.latestDeploymentId,
              })}
            >
              Deployment
            </InlineLink>
          ) : null}
          {preview.status === "cleanup_failed" ? (
            <ActionButton
              ariaLabel={`Retry cleanup for PR #${preview.pullRequestNumber}`}
              confirm={{
                title: "Retry Preview cleanup?",
                description:
                  "Retry removing this Preview\u2019s container, image, route, and DNS record.",
                actionLabel: "Retry cleanup",
              }}
              action={() =>
                api.post(`/v1/core/previews/${preview.id}/actions/delete`)
              }
              pendingLabel="Queueing…"
              success="Preview cleanup retry queued"
            >
              <HugeiconsIcon
                aria-hidden="true"
                icon={ReloadIcon}
                className="shrink-0"
              />
              Retry
            </ActionButton>
          ) : (
            <ActionButton
              action={() =>
                api.post(`/v1/core/previews/${preview.id}/actions/delete`)
              }
              confirm={{
                actionLabel: "Delete Preview",
                description:
                  "Towbar will remove this pull request's container, image, route, and DNS record. A later commit can create it again while the pull request remains open and Preview is enabled.",
                title: `Delete Preview for PR #${preview.pullRequestNumber}?`,
              }}
              isDisabled={preview.status === "deleting"}
              pendingLabel="Queueing…"
              success="Preview cleanup queued"
              variant="danger"
            >
              <HugeiconsIcon
                aria-hidden="true"
                icon={Delete02Icon}
                className="shrink-0"
              />
              Delete
            </ActionButton>
          )}
        </div>
      ),
    },
  ];

  return (
    <ResourceTable
      ariaLabel="Preview deployments"
      columns={columns}
      emptyDescription="Enable Preview for an app, then open a same-repository pull request targeting the Repository branch."
      emptyTitle="No Preview deployments"
      getRowKey={(preview) => preview.id}
      items={query.data.previews}
      tableClassName="min-w-[1040px]"
    />
  );
}
