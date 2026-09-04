"use client";

import {
  DashboardCircleIcon,
  DatabaseIcon,
  GithubIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type {
  App,
  Deployment,
  Resource,
  Server,
  Source,
} from "@workspace/towbar-web-client";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import {
  ResourceName,
  ResourceTable,
  type ResourceTableColumn,
} from "@workspace/towbar-web-ui/resource-table";
import { StatusBadge } from "@workspace/towbar-web-ui/status-badge";
import { ButtonLink } from "@workspace/web-design-system/buttons/button";

import { DashboardPage, InlineLink } from "@/components/page-parts";
import { useApiQuery } from "@/hooks/use-api-query";
import {
  getActiveDeploymentStates,
  resolveInventoryStatus,
} from "@/lib/inventory-status";
import { LastSyncedTime, RelativeTimeProvider } from "./last-synced-time";
import { DeployableName, ServerIpLink } from "./source-inventory";

type SourcesById = Map<string, Source>;

export function AppsIndex() {
  const apps = useApiQuery<{ apps: App[] }>("/v1/core/apps", 5_000);
  const deployments = useApiQuery<{ deployments: Deployment[] }>(
    "/v1/core/deployments",
    5_000,
  );
  const sources = useApiQuery<{ sources: Source[] }>("/v1/core/sources");
  const servers = useApiQuery<{ servers: Server[] }>("/v1/core/servers");
  const error =
    apps.error ?? deployments.error ?? sources.error ?? servers.error;

  return (
    <DashboardPage title="Apps">
      {error ? (
        <QueryError message={error} />
      ) : !apps.data || !deployments.data || !sources.data || !servers.data ? (
        <QueryLoading variant="table" />
      ) : (
        <DeployableInventory
          deployments={deployments.data.deployments}
          items={apps.data.apps}
          kind="app"
          servers={servers.data.servers}
          sources={sources.data.sources}
        />
      )}
    </DashboardPage>
  );
}

export function ResourcesIndex() {
  const deployments = useApiQuery<{ deployments: Deployment[] }>(
    "/v1/core/deployments",
    5_000,
  );
  const resources = useApiQuery<{ resources: Resource[] }>(
    "/v1/core/resources",
    5_000,
  );
  const sources = useApiQuery<{ sources: Source[] }>("/v1/core/sources");
  const servers = useApiQuery<{ servers: Server[] }>("/v1/core/servers");
  const error =
    deployments.error ?? resources.error ?? sources.error ?? servers.error;

  return (
    <DashboardPage title="Resources">
      {error ? (
        <QueryError message={error} />
      ) : !deployments.data ||
        !resources.data ||
        !sources.data ||
        !servers.data ? (
        <QueryLoading variant="table" />
      ) : (
        <DeployableInventory
          deployments={deployments.data.deployments}
          items={resources.data.resources}
          kind="resource"
          servers={servers.data.servers}
          sources={sources.data.sources}
        />
      )}
    </DashboardPage>
  );
}

export function ServersIndex() {
  const apps = useApiQuery<{ apps: App[] }>("/v1/core/apps", 5_000);
  const resources = useApiQuery<{ resources: Resource[] }>(
    "/v1/core/resources",
    5_000,
  );
  const servers = useApiQuery<{ servers: Server[] }>("/v1/core/servers", 5_000);
  const sources = useApiQuery<{ sources: Source[] }>("/v1/core/sources");
  const error = apps.error ?? resources.error ?? servers.error ?? sources.error;

  return (
    <DashboardPage
      actions={<ButtonLink href="/servers/new">Add server</ButtonLink>}
      title="Servers"
    >
      {error ? (
        <QueryError message={error} />
      ) : !apps.data || !resources.data || !servers.data || !sources.data ? (
        <QueryLoading variant="table" />
      ) : (
        <ServerInventory
          apps={apps.data.apps}
          resources={resources.data.resources}
          servers={servers.data.servers}
          sources={sources.data.sources}
        />
      )}
    </DashboardPage>
  );
}

function DeployableInventory({
  deployments,
  items,
  kind,
  servers,
  sources,
}: {
  deployments: Deployment[];
  items: App[] | Resource[];
  kind: "app" | "resource";
  servers: Server[];
  sources: Source[];
}) {
  const activeDeploymentStates = getActiveDeploymentStates(deployments);
  const sourcesById = new Map(sources.map((source) => [source.id, source]));
  const serverIdsByIp = new Map(
    servers.map((server) => [server.canonicalIp, server.id]),
  );
  const columns: ResourceTableColumn<App | Resource>[] = [
    {
      cell: (item) => (
        <DeployableName
          autoDeploy={Boolean(item.config.autoDeploy)}
          name={item.name}
        />
      ),
      className: "w-full min-w-64",
      header: kind === "app" ? "App" : "Resource",
      key: "name",
    },
    ...(kind === "resource"
      ? [
          {
            cell: (item: App | Resource) =>
              item.kind === "app" ? "App" : formatResourceKind(item.kind),
            className: "min-w-28",
            header: "Type",
            key: "type",
          } satisfies ResourceTableColumn<App | Resource>,
        ]
      : []),
    {
      cell: (item) => <SourceLink source={sourcesById.get(item.sourceId)} />,
      className: "min-w-56",
      header: "Source",
      key: "source",
    },
    {
      cell: (item) => (
        <ServerIpLink
          ip={item.serverIp}
          serverId={serverIdsByIp.get(item.serverIp)}
        />
      ),
      className: "min-w-36 tabular-nums",
      header: "Server",
      key: "server",
    },
    {
      cell: (item) => (
        <StatusBadge
          status={resolveInventoryStatus({
            activeDeploymentState: activeDeploymentStates.get(item.id),
            archived: Boolean(item.archivedAt),
            healthStatus: item.runtimeState.healthStatus,
            serverReady: item.serverReady,
          })}
        />
      ),
      className: "w-32",
      header: "Status",
      key: "status",
    },
    {
      cell: (item) => <LastSyncedTime value={item.updatedAt} />,
      className: "min-w-48 whitespace-nowrap",
      header: "Last synced",
      key: "last-synced",
    },
  ];

  return (
    <RelativeTimeProvider>
      <ResourceTable
        ariaLabel={kind === "app" ? "Apps" : "Resources"}
        columns={columns}
        emptyDescription={
          kind === "app"
            ? "A successful Source sync imports apps into this workspace."
            : "A successful Source sync imports resources into this workspace."
        }
        emptyTitle={kind === "app" ? "No apps yet" : "No resources yet"}
        getRowHref={(item) =>
          `/sources/${item.sourceId}/${kind === "app" ? "apps" : "resources"}/${item.id}`
        }
        getRowKey={(item) => item.id}
        items={items}
        tableClassName={kind === "app" ? "min-w-[920px]" : "min-w-[1040px]"}
      />
    </RelativeTimeProvider>
  );
}

function SourceLink({ source }: { source?: Source }) {
  if (!source) return "Unknown Source";
  const name = `${source.repositoryOwner}/${source.repositoryName}`;
  return (
    <InlineLink
      className="inline-flex min-w-0 items-center gap-2"
      href={`/sources/${source.id}`}
    >
      <HugeiconsIcon
        aria-hidden="true"
        className="text-muted-foreground size-4 shrink-0"
        icon={GithubIcon}
      />
      <span className="truncate" title={name}>
        {name}
      </span>
    </InlineLink>
  );
}

function ServerInventory({
  apps,
  resources,
  servers,
  sources,
}: {
  apps: App[];
  resources: Resource[];
  servers: Server[];
  sources: Source[];
}) {
  const sourcesById = new Map(sources.map((source) => [source.id, source]));
  const appCounts = countBy(apps, (app) => app.serverIp);
  const resourceCounts = countBy(resources, (resource) => resource.serverIp);
  const sourceIdsByServer = new Map<string, Set<string>>();
  for (const item of [...apps, ...resources]) {
    const sourceIds = sourceIdsByServer.get(item.serverIp) ?? new Set<string>();
    sourceIds.add(item.sourceId);
    sourceIdsByServer.set(item.serverIp, sourceIds);
  }
  const columns: ResourceTableColumn<Server>[] = [
    {
      cell: (server) => <ResourceName name={server.canonicalIp} />,
      className: "w-full min-w-52 tabular-nums",
      header: "Server",
      key: "server",
    },
    {
      cell: (server) => {
        const sourceIds = [
          ...(sourceIdsByServer.get(server.canonicalIp) ?? []),
        ];
        return sourceIds.length
          ? sourceIds
              .map((sourceId) => formatSource(sourcesById, sourceId))
              .sort((left, right) => left.localeCompare(right))
              .join(", ")
          : "No active Sources";
      },
      className: "min-w-56",
      header: "Sources",
      key: "sources",
    },
    {
      cell: (server) => {
        const appCount = appCounts.get(server.canonicalIp) ?? 0;
        const resourceCount = resourceCounts.get(server.canonicalIp) ?? 0;
        return (
          <span className="inline-flex items-center gap-5 whitespace-nowrap">
            <span
              aria-label={formatCount(appCount, "app")}
              className="inline-flex items-center gap-1.5"
              title={formatCount(appCount, "app")}
            >
              <HugeiconsIcon
                aria-hidden="true"
                className="text-muted-foreground size-4"
                icon={DashboardCircleIcon}
              />
              <span className="tabular-nums">{appCount}</span>
            </span>
            <span
              aria-label={formatCount(resourceCount, "resource")}
              className="inline-flex items-center gap-1.5"
              title={formatCount(resourceCount, "resource")}
            >
              <HugeiconsIcon
                aria-hidden="true"
                className="text-muted-foreground size-4"
                icon={DatabaseIcon}
              />
              <span className="tabular-nums">{resourceCount}</span>
            </span>
          </span>
        );
      },
      className: "min-w-36",
      header: "Workloads",
      key: "workloads",
    },
    {
      cell: (server) => (
        <StatusBadge
          status={server.archivedAt ? "archived" : server.setupStatus}
        />
      ),
      className: "w-32",
      header: "Status",
      key: "status",
    },
    {
      cell: (server) => <LastSyncedTime value={server.updatedAt} />,
      className: "min-w-48 whitespace-nowrap",
      header: "Updated",
      key: "updated",
    },
  ];

  return (
    <RelativeTimeProvider>
      <ResourceTable
        ariaLabel="Servers"
        columns={columns}
        emptyDescription="Add a server before syncing a Source that targets its IP address."
        emptyTitle="No servers yet"
        getRowHref={(server) => `/servers/${server.id}`}
        getRowKey={(server) => server.id}
        items={servers}
        tableClassName="min-w-[900px]"
      />
    </RelativeTimeProvider>
  );
}

function formatSource(sourcesById: SourcesById, sourceId: string) {
  const source = sourcesById.get(sourceId);
  return source
    ? `${source.repositoryOwner}/${source.repositoryName}`
    : "Unknown Source";
}

function formatResourceKind(kind: Resource["kind"]) {
  if (kind === "postgres") return "PostgreSQL";
  if (kind === "redis") return "Redis";
  return "Image";
}

function countBy<T>(items: T[], getKey: (item: T) => string) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = getKey(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function formatCount(count: number, singular: string) {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}
