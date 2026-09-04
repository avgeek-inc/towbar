"use client";

import { WebhookIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type {
  App,
  Deployment,
  DeploymentState,
  Resource,
  RuntimeCapacity,
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
} from "@/lib/inventory-status";
import { LastSyncedTime, RelativeTimeProvider } from "./last-synced-time";
import {
  RuntimeCpuMeter,
  RuntimeMemoryMeter,
  type RuntimeMetric,
} from "./server-capacity";

function appColumns(
  activeDeploymentStates: Map<string, DeploymentState>,
  runtimeById: Map<string, RuntimeMetric>,
): ResourceTableColumn<App>[] {
  return [
    {
      cell: (app) => (
        <DeployableName
          autoDeploy={Boolean(app.config.autoDeploy)}
          name={app.name}
        />
      ),
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
      cell: (app) => <RuntimeCpuMeter runtime={runtimeById.get(app.id)} />,
      className: "min-w-40",
      header: "CPU",
      key: "cpu",
    },
    {
      cell: (app) => <RuntimeMemoryMeter runtime={runtimeById.get(app.id)} />,
      className: "min-w-56",
      header: "Memory",
      key: "memory",
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
    {
      cell: (app) => <LastSyncedTime value={app.updatedAt} />,
      className: "min-w-48 whitespace-nowrap",
      header: "Last synced",
      key: "last-synced",
    },
  ];
}

function resourceColumns(
  activeDeploymentStates: Map<string, DeploymentState>,
  runtimeById: Map<string, RuntimeMetric>,
): ResourceTableColumn<Resource>[] {
  return [
    {
      cell: (resource) => (
        <DeployableName
          autoDeploy={Boolean(resource.config.autoDeploy)}
          name={resource.name}
        />
      ),
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
        <RuntimeCpuMeter runtime={runtimeById.get(resource.id)} />
      ),
      className: "min-w-40",
      header: "CPU",
      key: "cpu",
    },
    {
      cell: (resource) => (
        <RuntimeMemoryMeter runtime={runtimeById.get(resource.id)} />
      ),
      className: "min-w-56",
      header: "Memory",
      key: "memory",
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
    {
      cell: (resource) => <LastSyncedTime value={resource.updatedAt} />,
      className: "min-w-48 whitespace-nowrap",
      header: "Last synced",
      key: "last-synced",
    },
  ];
}

export function SourceApps({
  apps,
  capacities,
  deployments,
  error,
  sourceId,
}: {
  apps?: App[];
  capacities?: RuntimeCapacity[];
  deployments?: Deployment[];
  error?: string;
  sourceId: string;
}) {
  if (error) return <QueryError message={error} />;
  if (!apps || !capacities || !deployments)
    return <QueryLoading variant="list" />;
  const activeDeploymentStates = getActiveDeploymentStates(deployments);
  const runtimeById = getRuntimeByDeployableId(capacities);
  return (
    <RelativeTimeProvider>
      <ResourceTable
        ariaLabel="Source apps"
        columns={appColumns(activeDeploymentStates, runtimeById)}
        emptyDescription="A successful manifest sync imports this Source's apps."
        emptyTitle="No apps in this Source"
        getRowHref={(app) => `/sources/${sourceId}/apps/${app.id}`}
        getRowKey={(app) => app.id}
        items={apps}
        tableClassName="min-w-[1040px]"
      />
    </RelativeTimeProvider>
  );
}

export function SourceResources({
  capacities,
  deployments,
  error,
  resources,
  sourceId,
}: {
  capacities?: RuntimeCapacity[];
  deployments?: Deployment[];
  error?: string;
  resources?: Resource[];
  sourceId: string;
}) {
  if (error) return <QueryError message={error} />;
  if (!resources || !capacities || !deployments)
    return <QueryLoading variant="list" />;
  const activeDeploymentStates = getActiveDeploymentStates(deployments);
  const runtimeById = getRuntimeByDeployableId(capacities);
  return (
    <RelativeTimeProvider>
      <ResourceTable
        ariaLabel="Source resources"
        columns={resourceColumns(activeDeploymentStates, runtimeById)}
        emptyDescription="Declare an image, PostgreSQL, or Redis resource in this Source's manifest."
        emptyTitle="No resources in this Source"
        getRowHref={(resource) =>
          `/sources/${sourceId}/resources/${resource.id}`
        }
        getRowKey={(resource) => resource.id}
        items={resources}
        tableClassName="min-w-[1160px]"
      />
    </RelativeTimeProvider>
  );
}

export function DeployableName({
  autoDeploy,
  name,
}: {
  autoDeploy: boolean;
  name: string;
}) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <span className="truncate" title={name}>
        {name}
      </span>
      {autoDeploy ? (
        <span
          aria-label="Auto-deploy enabled"
          className="text-success-soft-foreground inline-flex size-5 shrink-0 self-center items-center justify-center leading-none"
          role="img"
          title="Auto-deploy enabled"
        >
          <HugeiconsIcon
            aria-hidden="true"
            className="size-4"
            icon={WebhookIcon}
          />
        </span>
      ) : null}
    </span>
  );
}

function formatResourceKind(kind: Resource["kind"]) {
  if (kind === "postgres") return "PostgreSQL";
  if (kind === "redis") return "Redis";
  return "Image";
}

function getRuntimeByDeployableId(capacities: RuntimeCapacity[]) {
  return new Map(
    capacities.flatMap((capacity) =>
      capacity.runtimes.map((runtime) => [runtime.id, runtime] as const),
    ),
  );
}
