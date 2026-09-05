"use client";

import { TooltipText } from "@workspace/web-design-system/overlays/tooltip";

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
import { RelativeTime } from "./last-synced-time";
import { formatDate } from "./dashboard-overview";

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
        <div className="flex flex-col items-start gap-0.5">
          <a
            className="focus-visible:ring-focus rounded-md underline decoration-muted underline-offset-4 outline-none hover:decoration-current focus-visible:ring-2"
            href={preview.pullRequestUrl}
            rel="noreferrer"
            target="_blank"
          >
            PR #{preview.pullRequestNumber}
          </a>
          <TooltipText
            className="max-w-48 truncate text-sm text-muted"
            tooltip={preview.branch}
          >
            {preview.branch}
          </TooltipText>
        </div>
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
      cell: (preview) =>
        preview.status === "healthy" ? (
          <a
            className="focus-visible:ring-focus inline-flex rounded-md underline decoration-muted underline-offset-4 outline-none hover:decoration-current focus-visible:ring-2"
            href={`https://${preview.hostname}`}
            rel="noreferrer"
            target="_blank"
          >
            {preview.hostname}
          </a>
        ) : (
          preview.hostname
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
        <div className="flex flex-col items-start gap-0.5">
          <StatusBadge status={preview.status} />
          {preview.status === "cleanup_failed" && preview.errorMessage ? (
            <span className="line-clamp-2 text-sm text-danger">
              {preview.errorMessage}
            </span>
          ) : null}
          {preview.status === "cleanup_failed" &&
          preview.nextCleanupAttemptAt ? (
            <span className="text-sm text-muted">
              Automatic retry {formatDate(preview.nextCleanupAttemptAt)}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      className: "whitespace-nowrap",
      cell: (preview) => (
        <div className="flex items-center gap-3">
          {preview.latestDeploymentId ? (
            <InlineLink
              href={`/sources/${preview.sourceId}/deployments/${preview.latestDeploymentId}`}
            >
              Deployment
            </InlineLink>
          ) : null}
          {preview.status === "cleanup_failed" ? (
            <ActionButton
              action={() =>
                api.post(`/v1/core/previews/${preview.id}/actions/delete`)
              }
              pendingLabel="Queueing…"
              success="Preview cleanup retry queued"
            >
              Retry cleanup
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
      emptyDescription="Enable Preview for an app, then open a same-repository pull request targeting the Source branch."
      emptyTitle="No Preview deployments"
      getRowKey={(preview) => preview.id}
      items={query.data.previews}
      tableClassName="min-w-[1040px]"
    />
  );
}
