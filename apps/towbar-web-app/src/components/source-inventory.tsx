"use client";

import {
  AlertCircleIcon,
  CheckIcon,
  CheckmarkCircle02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type {
  App,
  Deployment,
  DeploymentState,
  Resource,
  SourceServer,
} from "@workspace/towbar-web-client";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import {
  ResourceTable,
  type ResourceTableColumn,
} from "@workspace/towbar-web-ui/resource-table";
import { StatusBadge } from "@workspace/towbar-web-ui/status-badge";
import {
  getActiveDeploymentStates,
  resolveInventoryStatus,
  resolveInventorySyncStatus,
} from "@/lib/inventory-status";
import { LastSyncedTime, RelativeTimeProvider } from "./last-synced-time";

function appColumns(
  activeDeploymentStates: Map<string, DeploymentState>,
): ResourceTableColumn<App>[] {
  return [
    {
      cell: (app) => app.name,
      className: "min-w-56",
      header: "App Name",
      key: "name",
    },
    {
      cell: (app) => app.serverIp,
      className: "min-w-36 tabular-nums",
      header: "Server",
      key: "server",
    },
    {
      cell: (app) => (
        <AutoDeployIndicator enabled={Boolean(app.config.autoDeploy)} />
      ),
      className: "w-32",
      header: "Auto-deploy",
      key: "auto-deploy",
    },
    {
      cell: (app) => (
        <StatusBadge
          status={resolveInventorySyncStatus(
            app.runtimeState.driftStatus,
            activeDeploymentStates.get(app.id),
          )}
        />
      ),
      className: "w-32",
      header: "Sync status",
      key: "sync-status",
    },
    {
      cell: (app) => <LastSyncedTime value={app.updatedAt} />,
      className: "min-w-48 whitespace-nowrap",
      header: "Last synced",
      key: "last-synced",
    },
    {
      cell: (app) => (
        <StatusBadge
          status={resolveInventoryStatus({
            activeDeploymentState: activeDeploymentStates.get(app.id),
            archived: Boolean(app.archivedAt),
            healthStatus: app.runtimeState.healthStatus,
            serverReady: app.serverReady,
          })}
        />
      ),
      className: "w-32",
      header: "Status",
      key: "status",
    },
  ];
}

function resourceColumns(
  activeDeploymentStates: Map<string, DeploymentState>,
): ResourceTableColumn<Resource>[] {
  return [
    {
      cell: (resource) => resource.name,
      className: "min-w-56",
      header: "Resource Name",
      key: "name",
    },
    {
      cell: (resource) => formatResourceKind(resource.kind),
      className: "min-w-28",
      header: "Type",
      key: "type",
    },
    {
      cell: (resource) => resource.serverIp,
      className: "min-w-36 tabular-nums",
      header: "Server",
      key: "server",
    },
    {
      cell: (resource) => (
        <AutoDeployIndicator enabled={Boolean(resource.config.autoDeploy)} />
      ),
      className: "w-32",
      header: "Auto-deploy",
      key: "auto-deploy",
    },
    {
      cell: (resource) => (
        <StatusBadge
          status={resolveInventorySyncStatus(
            resource.runtimeState.driftStatus,
            activeDeploymentStates.get(resource.id),
          )}
        />
      ),
      className: "w-32",
      header: "Sync status",
      key: "sync-status",
    },
    {
      cell: (resource) => <LastSyncedTime value={resource.updatedAt} />,
      className: "min-w-48 whitespace-nowrap",
      header: "Last synced",
      key: "last-synced",
    },
    {
      cell: (resource) => (
        <StatusBadge
          status={resolveInventoryStatus({
            activeDeploymentState: activeDeploymentStates.get(resource.id),
            archived: Boolean(resource.archivedAt),
            healthStatus: resource.runtimeState.healthStatus,
            serverReady: resource.serverReady,
          })}
        />
      ),
      className: "w-32",
      header: "Status",
      key: "status",
    },
  ];
}

export function SourceApps({
  apps,
  deployments,
  error,
  sourceId,
}: {
  apps?: App[];
  deployments?: Deployment[];
  error?: string;
  sourceId: string;
}) {
  if (error) return <QueryError message={error} />;
  if (!apps || !deployments) return <QueryLoading variant="list" />;
  const activeDeploymentStates = getActiveDeploymentStates(deployments);
  return (
    <RelativeTimeProvider>
      <ResourceTable
        ariaLabel="Source apps"
        columns={appColumns(activeDeploymentStates)}
        emptyDescription="A successful manifest sync imports this Source's apps."
        emptyTitle="No apps in this Source"
        getRowHref={(app) => `/sources/${sourceId}/apps/${app.id}`}
        getRowKey={(app) => app.id}
        items={apps}
        tableClassName="min-w-[960px]"
      />
    </RelativeTimeProvider>
  );
}

export function SourceResources({
  deployments,
  error,
  resources,
  sourceId,
}: {
  deployments?: Deployment[];
  error?: string;
  resources?: Resource[];
  sourceId: string;
}) {
  if (error) return <QueryError message={error} />;
  if (!resources || !deployments) return <QueryLoading variant="list" />;
  const activeDeploymentStates = getActiveDeploymentStates(deployments);
  return (
    <RelativeTimeProvider>
      <ResourceTable
        ariaLabel="Source resources"
        columns={resourceColumns(activeDeploymentStates)}
        emptyDescription="Declare an image, PostgreSQL, or Redis resource in this Source's manifest."
        emptyTitle="No resources in this Source"
        getRowHref={(resource) =>
          `/sources/${sourceId}/resources/${resource.id}`
        }
        getRowKey={(resource) => resource.id}
        items={resources}
        tableClassName="min-w-[1080px]"
      />
    </RelativeTimeProvider>
  );
}

export function SourceServers({
  apps,
  deployments,
  error,
  resources,
  servers,
  sourceId,
}: {
  apps?: App[];
  deployments?: Deployment[];
  error?: string;
  resources?: Resource[];
  servers?: SourceServer[];
  sourceId: string;
}) {
  if (error) return <QueryError message={error} />;
  if (!servers || !apps || !resources || !deployments)
    return <QueryLoading variant="list" />;
  const activeDeploymentStates = getActiveDeploymentStates(deployments);
  const appCounts = new Map<string, number>();
  const resourceCounts = new Map<string, number>();
  const syncStatuses = new Map<
    string,
    App["runtimeState"]["driftStatus"] | DeploymentState
  >();
  for (const app of apps) {
    appCounts.set(app.serverIp, (appCounts.get(app.serverIp) ?? 0) + 1);
    syncStatuses.set(
      app.serverIp,
      mergeSyncStatus(
        syncStatuses.get(app.serverIp),
        resolveInventorySyncStatus(
          app.runtimeState.driftStatus,
          activeDeploymentStates.get(app.id),
        ),
      ),
    );
  }
  for (const resource of resources) {
    resourceCounts.set(
      resource.serverIp,
      (resourceCounts.get(resource.serverIp) ?? 0) + 1,
    );
    syncStatuses.set(
      resource.serverIp,
      mergeSyncStatus(
        syncStatuses.get(resource.serverIp),
        resolveInventorySyncStatus(
          resource.runtimeState.driftStatus,
          activeDeploymentStates.get(resource.id),
        ),
      ),
    );
  }
  const serverColumns: ResourceTableColumn<SourceServer>[] = [
    {
      cell: (server) => server.canonicalIp,
      className: "min-w-40 tabular-nums",
      header: "Server IP",
      key: "ip",
    },
    {
      cell: (server) => <HostKeyIndicator status={server.hostKeyStatus} />,
      className: "min-w-36",
      header: "Host Keys",
      key: "host-keys",
    },
    {
      cell: (server) => server.config.ssh.username,
      className: "min-w-36",
      header: "Username",
      key: "username",
    },
    {
      cell: (server) =>
        formatDeployableCounts(
          appCounts.get(server.canonicalIp) ?? 0,
          resourceCounts.get(server.canonicalIp) ?? 0,
        ),
      className: "min-w-48 tabular-nums",
      header: "Apps/Resources",
      key: "deployables",
    },
    {
      cell: (server) => (
        <StatusBadge
          status={syncStatuses.get(server.canonicalIp) ?? "unknown"}
        />
      ),
      className: "w-32",
      header: "Sync status",
      key: "sync-status",
    },
    {
      cell: (server) => <LastSyncedTime value={server.updatedAt} />,
      className: "min-w-48 whitespace-nowrap",
      header: "Last synced",
      key: "last-synced",
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
  ];
  return (
    <RelativeTimeProvider>
      <ResourceTable
        ariaLabel="Source servers"
        columns={serverColumns}
        emptyDescription="Declare a server in this Source's manifest to import it."
        emptyTitle="No servers in this Source"
        getRowHref={(server) => `/sources/${sourceId}/servers/${server.id}`}
        getRowKey={(server) => server.id}
        items={servers}
        tableClassName="min-w-[1160px]"
      />
    </RelativeTimeProvider>
  );
}

function HostKeyIndicator({
  status,
}: {
  status: SourceServer["hostKeyStatus"];
}) {
  const trusted = status === "trusted";
  return (
    <span
      className={`inline-flex items-center gap-2 ${trusted ? "text-success-soft-foreground" : "text-danger-soft-foreground"}`}
    >
      <HugeiconsIcon
        aria-hidden="true"
        className="size-4 shrink-0"
        icon={trusted ? CheckmarkCircle02Icon : AlertCircleIcon}
      />
      {trusted ? "Trusted" : "Untrusted"}
    </span>
  );
}

function AutoDeployIndicator({ enabled }: { enabled: boolean }) {
  return (
    <span className="inline-flex min-h-6 items-center">
      {enabled ? (
        <HugeiconsIcon
          aria-hidden="true"
          className="text-success-soft-foreground size-5"
          icon={CheckIcon}
        />
      ) : (
        <span aria-hidden="true" className="text-muted typography--body-sm">
          —
        </span>
      )}
      <span className="sr-only">
        Auto-deploy {enabled ? "enabled" : "disabled"}
      </span>
    </span>
  );
}

function formatResourceKind(kind: Resource["kind"]) {
  if (kind === "postgres") return "PostgreSQL";
  if (kind === "redis") return "Redis";
  return "Image";
}

function formatDeployableCounts(apps: number, resources: number) {
  return `${apps} ${apps === 1 ? "app" : "apps"} · ${resources} ${resources === 1 ? "resource" : "resources"}`;
}

function mergeSyncStatus(
  current: App["runtimeState"]["driftStatus"] | DeploymentState | undefined,
  next: App["runtimeState"]["driftStatus"] | DeploymentState,
): App["runtimeState"]["driftStatus"] | DeploymentState {
  if (current === "drifted" || next === "drifted") return "drifted";
  if (current && current !== "unknown" && current !== "in_sync") return current;
  if (next !== "unknown" && next !== "in_sync") return next;
  if (current === "unknown" || next === "unknown") return "unknown";
  return "in_sync";
}
