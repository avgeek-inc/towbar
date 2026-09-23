"use client";
import { useAccess } from "./access-context";
import {
  InventorySidebar,
  useInventoryQuery,
  type InventoryCounts,
} from "./inventory-sidebar";
import {
  Add01Icon,
  DashboardCircleIcon,
  CubeIcon,
  ServerStack01Icon,
  Layers01Icon,
  LeftToRightListBulletIcon,
} from "@hugeicons/core-free-icons";

import {
  Tooltip,
  TooltipText,
} from "@workspace/web-design-system/overlays/tooltip";

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
import {
  TableCellDescription,
  TableCellStack,
} from "@workspace/towbar-web-ui/table-cell-text";
import { ButtonLink } from "@workspace/web-design-system/buttons/button";
import {
  ToggleButton,
  ToggleButtonGroup,
} from "@workspace/web-design-system/buttons/toggle-button";

import { DashboardPage } from "@/components/page-parts";
import { useApiQuery } from "@/hooks/use-api-query";
import { useQueryChoice } from "@/hooks/use-page-query";
import {
  getActiveDeploymentStates,
  resolveInventoryStatus,
} from "@/lib/inventory-status";
import { DefinedCpuCapacity, DefinedMemoryCapacity } from "./server-capacity";
import {
  InventoryRuntimeCapacity,
  useInventoryRuntimeCapacity,
  useInventoryServerCapacity,
} from "./inventory-runtime-capacity";
import { formatBytes } from "./runtime-operations";
import { LastSyncedTime, RelativeTime } from "./last-synced-time";
import { formatDate } from "./dashboard-overview";
import { ScoutServerSummary } from "./scout-server-summary";
import { InstanceEnvironmentLabel } from "./instance-environment-label";
import { ServerIpLink } from "./source-inventory";
import { DeployableInventoryTable as GroupedDeployableTable } from "./deployable-inventory-table";
import { AppIdentity, ResourceIdentity } from "./deployable-identity";

const inventoryLayouts = ["grouped", "unified"] as const;

function isApp(item: App | Resource): item is App {
  return item.kind === "app" || item.kind === "compose";
}

function InventoryViewToggle({ kind }: { kind: "Apps" | "Resources" }) {
  const [layout, setLayout] = useQueryChoice(
    "layout",
    inventoryLayouts,
    "grouped",
  );
  return (
    <ToggleButtonGroup
      aria-label={`${kind} view`}
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={[layout]}
      onSelectionChange={(keys) =>
        setLayout(keys.has("unified") ? "unified" : "grouped")
      }
      size="sm"
    >
      <Tooltip>
        <ToggleButton id="grouped" isIconOnly aria-label="Grouped view">
          <HugeiconsIcon
            icon={Layers01Icon}
            className="size-4"
            aria-hidden="true"
          />
        </ToggleButton>
        <Tooltip.Content>Grouped view</Tooltip.Content>
      </Tooltip>
      <Tooltip>
        <ToggleButton id="unified" isIconOnly aria-label="Unified view">
          <HugeiconsIcon
            icon={LeftToRightListBulletIcon}
            className="size-4"
            aria-hidden="true"
          />
        </ToggleButton>
        <Tooltip.Content>Unified view</Tooltip.Content>
      </Tooltip>
    </ToggleButtonGroup>
  );
}

export function AppsIndex() {
  const apps = useApiQuery<{
    apps: App[];
    counts: InventoryCounts;
    environments: string[];
  }>(useInventoryQuery("apps"), 5_000);
  const deployments = useApiQuery<{ deployments: Deployment[] }>(
    "/v1/core/deployments",
    5_000,
  );
  const sources = useApiQuery<{ sources: Source[] }>("/v1/core/sources");
  const servers = useApiQuery<{ servers: Server[] }>("/v1/core/servers");
  const error =
    apps.error ?? deployments.error ?? sources.error ?? servers.error;

  return (
    <DashboardPage
      icon={DashboardCircleIcon}
      title="Apps"
      actions={<InventoryViewToggle kind="Apps" />}
    >
      <InventorySidebar
        kind="apps"
        counts={apps.data?.counts}
        environments={apps.data?.environments}
        sources={sources.data?.sources}
        servers={servers.data?.servers}
      />
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
  const resources = useApiQuery<{
    resources: Resource[];
    counts: InventoryCounts;
    environments: string[];
  }>(useInventoryQuery("resources"), 5_000);
  const sources = useApiQuery<{ sources: Source[] }>("/v1/core/sources");
  const servers = useApiQuery<{ servers: Server[] }>("/v1/core/servers");
  const error =
    deployments.error ?? resources.error ?? sources.error ?? servers.error;

  return (
    <DashboardPage
      icon={CubeIcon}
      title="Resources"
      actions={<InventoryViewToggle kind="Resources" />}
    >
      <InventorySidebar
        kind="resources"
        counts={resources.data?.counts}
        environments={resources.data?.environments}
        sources={sources.data?.sources}
        servers={servers.data?.servers}
      />
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
  const { can } = useAccess();
  const apps = useApiQuery<{ apps: App[] }>("/v1/core/apps", 5_000);
  const resources = useApiQuery<{ resources: Resource[] }>(
    "/v1/core/resources",
    5_000,
  );
  const servers = useApiQuery<{ servers: Server[]; counts: InventoryCounts }>(
    useInventoryQuery("servers"),
    30_000,
  );
  const error = apps.error ?? resources.error ?? servers.error;

  return (
    <DashboardPage
      icon={ServerStack01Icon}
      actions={
        can("server.update") ? (
          <ButtonLink href="/servers/new">
            <HugeiconsIcon
              aria-hidden="true"
              icon={Add01Icon}
              className="size-4 shrink-0"
            />
            Add server
          </ButtonLink>
        ) : undefined
      }
      title="Servers"
    >
      <InventorySidebar kind="servers" counts={servers.data?.counts} />
      {error ? (
        <QueryError message={error} />
      ) : !apps.data || !resources.data || !servers.data ? (
        <QueryLoading variant="table" />
      ) : (
        <InventoryRuntimeCapacity
          serverIds={servers.data.servers.map((server) => server.id)}
        >
          <ServerInventory
            apps={apps.data.apps}
            resources={resources.data.resources}
            servers={servers.data.servers}
          />
        </InventoryRuntimeCapacity>
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
  const [layout] = useQueryChoice("layout", inventoryLayouts, "grouped");
  const filtered = useInventoryQuery(
    kind === "app" ? "apps" : "resources",
  ).includes("?");
  const runtimeById = useInventoryRuntimeCapacity();
  const activeDeploymentStates = getActiveDeploymentStates(deployments);
  const sourcesById = new Map(sources.map((source) => [source.id, source]));
  const serversByIp = new Map(
    servers.map((server) => [server.canonicalIp, server]),
  );
  const columns: ResourceTableColumn<App | Resource>[] = [
    {
      cell: (item) =>
        isApp(item) ? (
          <AppIdentity app={item} />
        ) : (
          <ResourceIdentity resource={item} />
        ),
      className:
        kind === "resource"
          ? "resource-identity-cell w-full min-w-[22rem]"
          : "w-full min-w-64",
      wrapRowLink: false,
      header: kind === "app" ? "App" : "Resource",
      key: "name",
    },
    {
      cell: (item) => {
        const source = sourcesById.get(item.sourceId);
        return (
          <InstanceEnvironmentLabel
            environment={item.environment}
            repositoryName={
              source
                ? `${source.repositoryOwner}/${source.repositoryName}`
                : undefined
            }
          />
        );
      },
      className: "min-w-32",
      header: "Environment",
      key: "environment",
    },
    {
      cell: (item) => (
        <ServerIpLink
          ip={item.serverIp}
          serverId={serversByIp.get(item.serverIp)?.id}
          hardware={serversByIp.get(item.serverIp)?.hardware}
        />
      ),
      className: "hidden min-w-52 tabular-nums 2xl:table-cell",
      headerClassName: "hidden 2xl:table-cell",
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
      className: "hidden min-w-36 whitespace-nowrap 2xl:table-cell",
      headerClassName: "hidden 2xl:table-cell",
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
      className: "hidden min-w-40 whitespace-nowrap 2xl:table-cell",
      headerClassName: "hidden 2xl:table-cell",
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

  const InventoryTable =
    layout === "unified" ? ResourceTable : GroupedDeployableTable;
  return (
    <InventoryTable
      ariaLabel={kind === "app" ? "Apps" : "Resources"}
      columns={columns}
      emptyDescription={
        filtered
          ? "Try changing or clearing the filters."
          : kind === "app"
            ? "A successful Repository sync imports apps into this workspace."
            : "A successful Repository sync imports resources into this workspace."
      }
      emptyTitle={
        filtered
          ? "No matching workloads"
          : kind === "app"
            ? "No apps yet"
            : "No resources yet"
      }
      getRowHref={(item) =>
        `/${kind === "app" ? "apps" : "resources"}/${item.id}`
      }
      getRowKey={(item) => item.id}
      items={items}
      tableClassName="min-w-[680px]"
    />
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
  const filtered = useInventoryQuery("servers").includes("?");
  const appCounts = countBy(apps, (app) => app.serverIp);
  const resourceCounts = countBy(resources, (resource) => resource.serverIp);
  const capacityByServer = useInventoryServerCapacity();
  const columns: ResourceTableColumn<Server>[] = [
    {
      cell: (server) => (
        <ServerIpLink
          ip={server.canonicalIp}
          description={
            server.setupStatus === "pending" ? "Pending Setup" : undefined
          }
          hardware={server.hardware}
        />
      ),
      className: "w-full min-w-52 tabular-nums",
      header: "Server",
      key: "server",
    },
    {
      cell: (server) => <ScoutServerSummary server={server} />,
      className: "min-w-40",
      header: "Scout Agent",
      key: "scout",
    },
    {
      cell: (server) => (
        <ServerCapacityCell
          value={
            server.hardware?.cpuCount
              ? `${server.hardware.cpuCount} vCPU`
              : null
          }
          usedPercent={capacityByServer.get(server.id)?.cpu?.usagePercent}
          checkedAt={capacityByServer.get(server.id)?.checkedAt}
        />
      ),
      className: "min-w-32 whitespace-nowrap tabular-nums",
      header: "CPU capacity",
      key: "max-cpu",
    },
    {
      cell: (server) => (
        <ServerCapacityCell
          value={
            server.hardware?.memoryBytes
              ? formatBytes(server.hardware.memoryBytes)
              : null
          }
          usedPercent={capacityByServer.get(server.id)?.memory?.usedPercent}
          checkedAt={capacityByServer.get(server.id)?.checkedAt}
        />
      ),
      className: "min-w-36 whitespace-nowrap tabular-nums",
      header: "Memory capacity",
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
                icon={CubeIcon}
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
      className: "w-32 whitespace-nowrap",
      header: "Status",
      key: "status",
    },
    {
      cell: (server) => (
        <RelativeTime label="Updated" value={server.updatedAt} />
      ),
      className: "hidden min-w-48 whitespace-nowrap 2xl:table-cell",
      headerClassName: "hidden 2xl:table-cell",
      header: "Updated",
      key: "updated",
    },
  ];

  return (
    <ResourceTable
      ariaLabel="Servers"
      columns={columns}
      emptyDescription={
        filtered
          ? "Try changing or clearing the filters."
          : "Add a server before syncing a Repository that targets its IP address."
      }
      emptyTitle={filtered ? "No matching servers" : "No servers yet"}
      getRowHref={(server) => `/servers/${server.id}`}
      getRowKey={(server) => server.id}
      items={servers}
      tableClassName="min-w-[680px] 2xl:min-w-[1120px]"
    />
  );
}

function ServerCapacityCell({
  value,
  usedPercent,
  checkedAt,
}: {
  value: string | null;
  usedPercent: number | null | undefined;
  checkedAt: string | null | undefined;
}) {
  const hasUsage =
    usedPercent !== null && usedPercent !== undefined && checkedAt;
  return (
    <TableCellStack>
      <span>{value ?? "Unknown"}</span>
      <TableCellDescription>
        {hasUsage ? (
          <TooltipText tooltip={`Recorded ${formatDate(checkedAt)}`}>
            {formatUsagePercent(usedPercent)}% used
          </TooltipText>
        ) : (
          "Not measured"
        )}
      </TableCellDescription>
    </TableCellStack>
  );
}

function formatUsagePercent(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
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
