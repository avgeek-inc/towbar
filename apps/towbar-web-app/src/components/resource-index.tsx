"use client";
import { useState } from "react";
import { SourceCreateModal } from "./source-create";
import {
  InventorySidebar,
  useInventoryQuery,
  type InventoryCounts,
} from "./inventory-sidebar";
import {
  Add01Icon,
  DashboardCircleIcon,
  DatabaseIcon,
  GithubIcon,
  GitBranchIcon,
  ServerStack01Icon,
} from "@hugeicons/core-free-icons";

import { TooltipText } from "@workspace/web-design-system/overlays/tooltip";

import { HugeiconsIcon } from "@hugeicons/react";
import { useRouter } from "next/navigation";
import type { App, Resource, Source } from "@workspace/towbar-web-client";
import { Button } from "@workspace/web-design-system/buttons/button";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import {
  ResourceTable,
  type ResourceTableColumn,
} from "@workspace/towbar-web-ui/resource-table";
import { StatusBadge } from "@workspace/towbar-web-ui/status-badge";

import { DashboardPage } from "@/components/page-parts";
import { prefetchApiQueries, useApiQuery } from "@/hooks/use-api-query";
import { countSourceInventory } from "@/lib/source-inventory";
import { LastSyncedTime } from "./last-synced-time";

export function SourceIndex() {
  const router = useRouter();
  const [addingSource, setAddingSource] = useState(false);
  const filtered = useInventoryQuery("sources").includes("?");
  const query = useApiQuery<{ sources: Source[]; counts: InventoryCounts }>(
    useInventoryQuery("sources"),
    5_000,
  );
  const apps = useApiQuery<{ apps: App[] }>("/v1/core/apps", 5_000);
  const resources = useApiQuery<{ resources: Resource[] }>(
    "/v1/core/resources",
    5_000,
  );
  const error = query.error ?? apps.error ?? resources.error;
  const inventory = countSourceInventory(
    apps.data?.apps ?? [],
    resources.data?.resources ?? [],
  );
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
        <span className="flex min-w-0 items-center gap-2">
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
      key: "inventory",
      header: "Inventory",
      className: "min-w-44 whitespace-nowrap",
      cell: (source) => {
        const counts = inventory.get(source.id);
        return (
          <span className="inline-flex items-center gap-4">
            {[
              {
                label: "app",
                count: counts?.apps ?? 0,
                icon: DashboardCircleIcon,
              },
              {
                label: "resource",
                count: counts?.resources ?? 0,
                icon: DatabaseIcon,
              },
              {
                label: "server",
                count: counts?.servers.size ?? 0,
                icon: ServerStack01Icon,
              },
            ].map(({ label, count, icon }) => (
              <TooltipText
                key={label}
                aria-label={`${count} ${label}${count === 1 ? "" : "s"}`}
                tooltip={`${count} ${label}${count === 1 ? "" : "s"}`}
                className="inline-flex items-center gap-1.5"
              >
                <HugeiconsIcon
                  aria-hidden="true"
                  icon={icon}
                  className="size-4 text-muted-foreground"
                />
                <span className="tabular-nums">{count}</span>
              </TooltipText>
            ))}
          </span>
        );
      },
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
      actions={
        <Button onPress={() => setAddingSource(true)}>
          <HugeiconsIcon
            aria-hidden="true"
            icon={Add01Icon}
            className="size-4 shrink-0"
          />
          Add source
        </Button>
      }
      title="Sources"
    >
      {addingSource ? (
        <SourceCreateModal onClose={() => setAddingSource(false)} />
      ) : null}
      <InventorySidebar kind="sources" counts={query.data?.counts} />
      {error ? (
        <QueryError message={error} />
      ) : !query.data || !apps.data || !resources.data ? (
        <QueryLoading variant="table" />
      ) : (
        <ResourceTable
          ariaLabel="Sources"
          columns={columns}
          emptyAction={
            <Button onPress={() => setAddingSource(true)}>
              <HugeiconsIcon
                aria-hidden="true"
                icon={Add01Icon}
                className="size-4 shrink-0"
              />
              Add source
            </Button>
          }
          emptyDescription={
            filtered
              ? "Try changing or clearing the filters."
              : "Connect a GitHub repository to import its Towbar manifest."
          }
          emptyTitle={filtered ? "No matching sources" : "No sources yet"}
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
          tableClassName="min-w-[900px]"
        />
      )}
    </DashboardPage>
  );
}
