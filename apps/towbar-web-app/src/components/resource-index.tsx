"use client";

import { TooltipText } from "@workspace/web-design-system/overlays/tooltip";

import { GithubIcon, GitBranchIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useRouter } from "next/navigation";
import type { Source } from "@workspace/towbar-web-client";
import { ButtonLink } from "@workspace/web-design-system/buttons/button";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import {
  ResourceTable,
  type ResourceTableColumn,
} from "@workspace/towbar-web-ui/resource-table";
import { StatusBadge } from "@workspace/towbar-web-ui/status-badge";

import { DashboardPage } from "@/components/page-parts";
import { prefetchApiQueries, useApiQuery } from "@/hooks/use-api-query";
import { LastSyncedTime } from "./last-synced-time";

export function SourceIndex() {
  const router = useRouter();
  const query = useApiQuery<{ sources: Source[] }>("/v1/core/sources");
  function prepareSource(source: Source) {
    const href = `/sources/${source.id}`;
    router.prefetch(href);
    return prefetchApiQueries([
      `/v1/core/sources/${source.id}`,
      `/v1/core/sources/${source.id}/manifest`,
      `/v1/core/sources/${source.id}/syncs`,
      `/v1/core/sources/${source.id}/apps`,
      `/v1/core/sources/${source.id}/resources`,
    ]);
  }
  const columns: ResourceTableColumn<Source>[] = [
    {
      key: "repository",
      header: "Source Repo",
      cell: (source) => (
        <span className="flex min-w-0 items-center gap-2 font-medium">
          <HugeiconsIcon
            aria-hidden="true"
            className="size-5 shrink-0"
            icon={GithubIcon}
          />
          <TooltipText
            className="truncate"
            tooltip={`${source.repositoryOwner}/${source.repositoryName}`}
          >
            {source.repositoryOwner}/{source.repositoryName}
          </TooltipText>
        </span>
      ),
      className: "w-full min-w-72",
    },
    {
      key: "branch",
      header: "Branch",
      cell: (source) => source.branch,
      className: "min-w-32 whitespace-nowrap",
    },
    {
      key: "last-synced",
      header: "Last synced",
      cell: (source) => <LastSyncedTime value={source.updatedAt} />,
      className: "min-w-48 whitespace-nowrap",
    },
    {
      key: "status",
      header: "Status",
      cell: (source) => <StatusBadge status={source.status} />,
    },
  ];

  return (
    <DashboardPage
      icon={GitBranchIcon}
      actions={<ButtonLink href="/sources/new">Add source</ButtonLink>}
      title="Sources"
    >
      {query.error ? (
        <QueryError message={query.error} />
      ) : !query.data ? (
        <QueryLoading variant="table" />
      ) : (
        <ResourceTable
          ariaLabel="Sources"
          columns={columns}
          emptyAction={<ButtonLink href="/sources/new">Add source</ButtonLink>}
          emptyDescription="Connect a GitHub repository to import its Towbar manifest."
          emptyTitle="No sources yet"
          getRowHref={(source) => `/sources/${source.id}`}
          getRowKey={(source) => source.id}
          items={query.data.sources}
          onRowLinkIntent={(source) => {
            void prepareSource(source).catch(() => undefined);
          }}
          onRowLinkNavigate={(source, event) => {
            event.preventDefault();
            void Promise.race([
              prepareSource(source),
              new Promise((resolve) => setTimeout(resolve, 150)),
            ])
              .catch(() => undefined)
              .finally(() => router.push(`/sources/${source.id}`));
          }}
          tableClassName="min-w-[720px]"
        />
      )}
    </DashboardPage>
  );
}
