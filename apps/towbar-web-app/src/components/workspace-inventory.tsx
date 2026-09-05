"use client";

import { TooltipText } from "@workspace/web-design-system/overlays/tooltip";

import {
  DashboardCircleIcon,
  DatabaseIcon,
  GithubIcon,
  ServerStack01Icon,
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
import { DefinedCpuCapacity, DefinedMemoryCapacity } from "./server-capacity";
import {
  InventoryRuntimeCapacity,
  useInventoryRuntimeCapacity,
} from "./inventory-runtime-capacity";
import { formatBytes } from "./runtime-operations";
import { LastSyncedTime, RelativeTime } from "./last-synced-time";
import { ServerIpLink } from "./source-inventory";
import { AppIdentity, ResourceIdentity } from "./deployable-identity";

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
    <DashboardPage icon={DashboardCircleIcon} title="Apps">
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
    <DashboardPage icon={DatabaseIcon} title="Resources">
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
  const error = apps.error ?? resources.error ?? servers.error;

  return (
    <DashboardPage
      icon={ServerStack01Icon}
      actions={<ButtonLink href="/servers/new">Add server</ButtonLink>}
      title="Servers"
    >
      {error ? (
        <QueryError message={error} />
      ) : !apps.data || !resources.data || !servers.data ? (
        <QueryLoading variant="table" />
      ) : (
        <ServerInventory
          apps={apps.data.apps}
          resources={resources.data.resources}
          servers={servers.data.servers}
        />
      )}
    </DashboardPage>
  );
}

function DeployableInventory(props: DeployableInventoryProps) {
  const serverIps = new Set(props.items.map((item) => item.serverIp));
  const serverIds = props.servers
    .filter((server) => serverIps.has(server.canonicalIp))
    .map((server) => server.id);
  return (
    <InventoryRuntimeCapacity serverIds={serverIds}>
      <DeployableInventoryTable {...props} />
    </InventoryRuntimeCapacity>
  );
}

type DeployableInventoryProps = {
  deployments: Deployment[];
  items: App[] | Resource[];
  kind: "app" | "resource";
  servers: Server[];
  sources: Source[];
};

function DeployableInventoryTable({
  deployments,
  items,
  kind,
  servers,
  sources,
}: DeployableInventoryProps) {
  const runtimeById = useInventoryRuntimeCapacity();
  const activeDeploymentStates = getActiveDeploymentStates(deployments);
  const sourcesById = new Map(sources.map((source) => [source.id, source]));
  const serversByIp = new Map(
    servers.map((server) => [server.canonicalIp, server]),
  );
  const columns: ResourceTableColumn<App | Resource>[] = [
    {
      cell: (item) =>
        item.kind === "app" ? (
          <AppIdentity app={item} />
        ) : (
          <ResourceIdentity resource={item} />
        ),
      className: "w-full min-w-88",
      wrapRowLink: false,
      header: kind === "app" ? "App" : "Resource",
      key: "name",
    },
    {
      cell: (item) => <SourceLink source={sourcesById.get(item.sourceId)} />,
      className: "min-w-40",
      header: "Source",
      key: "source",
    },
    {
      cell: (item) => (
        <ServerIpLink
          ip={item.serverIp}
          serverId={serversByIp.get(item.serverIp)?.id}
          hardware={serversByIp.get(item.serverIp)?.hardware}
        />
      ),
      className: "min-w-52 tabular-nums",
      header: "Server",
      key: "server",
    },
    {
      cell: (item) => (
        <DefinedCpuCapacity
          limits={item.config.container.resources}
          runtime={runtimeById.get(item.id)}
        />
      ),
      className: "min-w-36 whitespace-nowrap",
      header: "Allocated CPU",
      key: "defined-cpu",
    },
    {
      cell: (item) => (
        <DefinedMemoryCapacity
          limits={item.config.container.resources}
          runtime={runtimeById.get(item.id)}
        />
      ),
      className: "min-w-40 whitespace-nowrap",
      header: "Allocated Memory",
      key: "defined-memory",
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
      <TooltipText className="truncate" tooltip={name}>
        {source.repositoryName}
      </TooltipText>
    </InlineLink>
  );
}

function ServerInventory({
  apps,
  resources,
  servers,
}: {
  apps: App[];
  resources: Resource[];
  servers: Server[];
}) {
  const appCounts = countBy(apps, (app) => app.serverIp);
  const resourceCounts = countBy(resources, (resource) => resource.serverIp);
  const columns: ResourceTableColumn<Server>[] = [
    {
      cell: (server) => (
        <ServerIpLink ip={server.canonicalIp} hardware={server.hardware} />
      ),
      className: "w-full min-w-52 tabular-nums",
      header: "Server",
      key: "server",
    },
    {
      cell: (server) =>
        server.hardware?.cpuCount
          ? `${server.hardware.cpuCount} vCPU`
          : "Unknown",
      className: "min-w-32 whitespace-nowrap tabular-nums",
      header: "Max CPU",
      key: "max-cpu",
    },
    {
      cell: (server) =>
        server.hardware?.memoryBytes
          ? formatBytes(server.hardware.memoryBytes)
          : "Unknown",
      className: "min-w-36 whitespace-nowrap tabular-nums",
      header: "Max Memory",
      key: "max-memory",
    },
    {
      cell: (server) => {
        const appCount = appCounts.get(server.canonicalIp) ?? 0;
        const resourceCount = resourceCounts.get(server.canonicalIp) ?? 0;
        return (
          <span className="inline-flex items-center gap-5 whitespace-nowrap">
            <TooltipText
              aria-label={formatCount(appCount, "app")}
              className="inline-flex items-center gap-1.5"
              tooltip={formatCount(appCount, "app")}
            >
              <HugeiconsIcon
                aria-hidden="true"
                className="text-muted-foreground size-4"
                icon={DashboardCircleIcon}
              />
              <span className="tabular-nums">{appCount}</span>
            </TooltipText>
            <TooltipText
              aria-label={formatCount(resourceCount, "resource")}
              className="inline-flex items-center gap-1.5"
              tooltip={formatCount(resourceCount, "resource")}
            >
              <HugeiconsIcon
                aria-hidden="true"
                className="text-muted-foreground size-4"
                icon={DatabaseIcon}
              />
              <span className="tabular-nums">{resourceCount}</span>
            </TooltipText>
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
      cell: (server) => (
        <RelativeTime label="Updated" value={server.updatedAt} />
      ),
      className: "min-w-48 whitespace-nowrap",
      header: "Updated",
      key: "updated",
    },
  ];

  return (
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
  );
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
