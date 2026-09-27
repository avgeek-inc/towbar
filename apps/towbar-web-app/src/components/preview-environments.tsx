"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { Delete02Icon, ReloadIcon } from "@hugeicons/core-free-icons";

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
import { api } from "@/lib/api";
import { deploymentHref } from "@/lib/deployment-route";
import { RelativeTime } from "./last-synced-time";
import { formatDate } from "./dashboard-overview";
import { DomainLink } from "./domain-link";

export function PreviewEnvironments({
  previews,
  error,
}: {
  previews?: PreviewEnvironment[];
  error?: string;
}) {
  if (error) return <QueryError message={error} />;
  if (!previews) return <QueryLoading variant="list" />;

  const columns: ResourceTableColumn<PreviewEnvironment>[] = [
    {
      key: "pull-request",
      header: "Pull request",
      className: "min-w-32",
      cell: (preview) => (
        <a
          className="focus-visible:ring-focus rounded-md underline decoration-muted underline-offset-4 outline-none hover:decoration-current focus-visible:ring-2"
          href={preview.pullRequestUrl}
          rel="noreferrer"
          target="_blank"
        >
          PR #{preview.pullRequestNumber}
          <NewTabIndicator />
        </a>
      ),
    },
    {
      key: "url",
      header: "URL",
      className: "w-56 max-w-56",
      cell: (preview) => (
        <TooltipText
          className="block max-w-56 truncate"
          tooltip={preview.hostname}
        >
          <DomainLink
            className="block truncate"
            domain={preview.hostname}
            showTooltip={false}
          >
            {compactPreviewHostname(preview.hostname)}
          </DomainLink>
        </TooltipText>
      ),
    },
    {
      key: "branch",
      header: "Branch",
      className: "w-48 max-w-48",
      cell: (preview) => (
        <TooltipText
          className="block max-w-48 truncate"
          tooltip={preview.branch}
        >
          <TypographyCode className="block truncate rounded-none bg-transparent p-0 text-xs/4">
            {preview.branch}
          </TypographyCode>
        </TooltipText>
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
      key: "deployment",
      header: "Deployment",
      className: "min-w-36 whitespace-nowrap",
      cell: (preview) =>
        preview.latestDeploymentId ? (
          <InlineLink
            href={deploymentHref({
              appId: preview.appId,
              deployableKind: "app",
              id: preview.latestDeploymentId,
            })}
            title={preview.latestDeploymentId}
          >
            <TypographyCode>
              {preview.latestDeploymentId.slice(0, 8)}
            </TypographyCode>
          </InlineLink>
        ) : (
          <span className="text-muted">—</span>
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
        <StatusBadge
          status={preview.status}
          tooltip={previewCleanupTooltip(preview)}
        />
      ),
    },
    {
      key: "actions",
      header: "Actions",
      className: "whitespace-nowrap",
      cell: (preview) => (
        <div className="flex items-center gap-2">
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
      emptyDescription="Enable Preview for a service, then open a same-repository pull request targeting the Repository branch."
      emptyTitle="No Preview deployments"
      getRowKey={(preview) => preview.id}
      items={previews}
      tableClassName="min-w-[1040px]"
    />
  );
}

function previewCleanupTooltip(preview: PreviewEnvironment) {
  if (
    preview.status !== "cleanup_failed" ||
    (!preview.errorMessage && !preview.nextCleanupAttemptAt)
  ) {
    return undefined;
  }

  return (
    <span className="grid gap-1">
      <span>
        {preview.errorMessage ??
          "Cleanup stopped before every item could be removed."}
      </span>
      {preview.nextCleanupAttemptAt ? (
        <span>Retry scheduled {formatDate(preview.nextCleanupAttemptAt)}</span>
      ) : null}
    </span>
  );
}

function compactPreviewHostname(hostname: string) {
  const [label, ...suffix] = hostname.split(".");
  if (!label || label.length <= 18 || suffix.length === 0) return hostname;
  return `${label.slice(0, 15)}…${suffix.length ? `.${suffix.join(".")}` : ""}`;
}
