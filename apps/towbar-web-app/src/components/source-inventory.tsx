"use client";

import { TooltipText } from "@workspace/web-design-system/overlays/tooltip";

import Image from "next/image";

import {
  HeartPulseIcon,
  InternetIcon,
  ServerStack01Icon,
  WebhookIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type {
  App,
  Deployment,
  DeploymentState,
  Resource,
  RuntimeCapacity,
  Server,
} from "@workspace/towbar-web-client";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import {
  ResourceTable,
  type ResourceTableColumn,
} from "@workspace/towbar-web-ui/resource-table";
import { StatusBadge } from "@workspace/towbar-web-ui/status-badge";
import { Tooltip } from "@workspace/web-design-system/overlays/tooltip";
import { ServerHardwareDescription } from "./server-hardware";
import { InlineLink } from "@/components/page-parts";
import {
  getActiveDeploymentStates,
  resolveInventoryStatus,
} from "@/lib/inventory-status";
import { LastSyncedTime } from "./last-synced-time";
import {
  DefinedCpuCapacity,
  DefinedMemoryCapacity,
  type RuntimeMetric,
} from "./server-capacity";

function appColumns(
  activeDeploymentStates: Map<string, DeploymentState>,
  runtimeById: Map<string, RuntimeMetric>,
  serversByIp: Map<string, Server>,
): ResourceTableColumn<App>[] {
  return [
    {
      cell: (app) => <AppIdentity app={app} />,
      wrapRowLink: false,
      className: "min-w-56",
      header: "App Name",
      key: "name",
    },
    {
      cell: (app) => (
        <ServerIpLink
          ip={app.serverIp}
          serverId={serversByIp.get(app.serverIp)?.id}
          hardware={serversByIp.get(app.serverIp)?.hardware}
        />
      ),
      className: "min-w-52 tabular-nums",
      header: "Server",
      key: "server",
    },
    {
      cell: (app) => (
        <DefinedCpuCapacity
          limits={app.config.container.resources}
          runtime={runtimeById.get(app.id)}
        />
      ),
      className: "min-w-40",
      header: "Defined CPU",
      key: "cpu",
    },
    {
      cell: (app) => (
        <DefinedMemoryCapacity
          limits={app.config.container.resources}
          runtime={runtimeById.get(app.id)}
        />
      ),
      className: "min-w-56",
      header: "Defined Memory",
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
  serversByIp: Map<string, Server>,
): ResourceTableColumn<Resource>[] {
  return [
    {
      cell: (resource) => <ResourceIdentity resource={resource} />,
      className: "min-w-56",
      wrapRowLink: false,
      header: "Resource Name",
      key: "name",
    },
    {
      cell: (resource) => (
        <ServerIpLink
          ip={resource.serverIp}
          serverId={serversByIp.get(resource.serverIp)?.id}
          hardware={serversByIp.get(resource.serverIp)?.hardware}
        />
      ),
      className: "min-w-52 tabular-nums",
      header: "Server",
      key: "server",
    },
    {
      cell: (resource) => (
        <DefinedCpuCapacity
          limits={resource.config.container.resources}
          runtime={runtimeById.get(resource.id)}
        />
      ),
      className: "min-w-40",
      header: "Defined CPU",
      key: "cpu",
    },
    {
      cell: (resource) => (
        <DefinedMemoryCapacity
          limits={resource.config.container.resources}
          runtime={runtimeById.get(resource.id)}
        />
      ),
      className: "min-w-56",
      header: "Defined Memory",
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
  servers,
  sourceId,
}: {
  apps?: App[];
  capacities?: RuntimeCapacity[];
  deployments?: Deployment[];
  error?: string;
  servers?: Server[];
  sourceId: string;
}) {
  if (error) return <QueryError message={error} />;
  if (!apps || !capacities || !deployments || !servers)
    return <QueryLoading variant="list" />;
  const activeDeploymentStates = getActiveDeploymentStates(deployments);
  const runtimeById = getRuntimeByDeployableId(capacities);
  const serversByIp = getServersByIp(servers);
  return (
    <ResourceTable
      ariaLabel="Source apps"
      columns={appColumns(activeDeploymentStates, runtimeById, serversByIp)}
      emptyDescription="A successful manifest sync imports this Source's apps."
      emptyTitle="No apps in this Source"
      getRowHref={(app) => `/sources/${sourceId}/apps/${app.id}`}
      getRowKey={(app) => app.id}
      items={apps}
      tableClassName="min-w-[1040px]"
    />
  );
}

export function SourceResources({
  capacities,
  deployments,
  error,
  resources,
  servers,
  sourceId,
}: {
  capacities?: RuntimeCapacity[];
  deployments?: Deployment[];
  error?: string;
  resources?: Resource[];
  servers?: Server[];
  sourceId: string;
}) {
  if (error) return <QueryError message={error} />;
  if (!resources || !capacities || !deployments || !servers)
    return <QueryLoading variant="list" />;
  const activeDeploymentStates = getActiveDeploymentStates(deployments);
  const runtimeById = getRuntimeByDeployableId(capacities);
  const serversByIp = getServersByIp(servers);
  return (
    <ResourceTable
      ariaLabel="Source resources"
      columns={resourceColumns(
        activeDeploymentStates,
        runtimeById,
        serversByIp,
      )}
      emptyDescription="Declare an image, PostgreSQL, or Redis resource in this Source's manifest."
      emptyTitle="No resources in this Source"
      getRowHref={(resource) => `/sources/${sourceId}/resources/${resource.id}`}
      getRowKey={(resource) => resource.id}
      items={resources}
      tableClassName="min-w-[1160px]"
    />
  );
}

export function AppIdentity({ app }: { app: App }) {
  const domains = [
    ...new Set(
      [
        app.config.domains?.primary,
        ...(app.config.domains?.redirects.map(({ host }) => host) ?? []),
      ].filter((domain): domain is string => Boolean(domain)),
    ),
  ];

  return (
    <span className="grid min-w-0 justify-items-start gap-1">
      <DeployableName
        autoDeploy={Boolean(app.config.autoDeploy)}
        name={app.name}
        href={`/sources/${app.sourceId}/apps/${app.id}`}
        exposed={domains.length > 0}
        health={app.runtimeState.healthStatus}
      />
      {domains.length > 0 ? (
        <Tooltip>
          <Tooltip.Trigger
            render={(props) => <span {...props} />}
            aria-label={`Domains: ${domains.join(", ")}`}
            className="flex max-w-64 min-w-0 items-center gap-1 text-xs text-muted outline-none focus-visible:ring-2 focus-visible:ring-focus rounded-sm"
          >
            <span className="truncate">{domains[0]}</span>
            {domains.length > 1 ? (
              <span className="shrink-0 tabular-nums">
                +{domains.length - 1}
              </span>
            ) : null}
          </Tooltip.Trigger>
          <Tooltip.Content
            className="max-w-xs text-xs"
            placement="top"
            showArrow
          >
            <Tooltip.Arrow />
            <span className="grid gap-1">
              {domains.map((domain) => (
                <span className="break-all" key={domain}>
                  {domain}
                </span>
              ))}
            </span>
          </Tooltip.Content>
        </Tooltip>
      ) : (
        <span className="text-xs text-muted">Not publicly exposed</span>
      )}
    </span>
  );
}

function DeployableName({
  autoDeploy,
  name,
  href,
  exposed,
  health,
}: {
  autoDeploy: boolean;
  name: string;
  href: string;
  exposed: boolean;
  health: App["runtimeState"]["healthStatus"];
}) {
  const indicators = [
    {
      icon: WebhookIcon,
      positive: autoDeploy,
      label: autoDeploy ? "Auto-deploy enabled" : "Auto-deploy disabled",
    },
    {
      icon: InternetIcon,
      positive: exposed,
      label: exposed
        ? "Publicly exposed to the internet"
        : "Not publicly exposed",
    },
    {
      icon: HeartPulseIcon,
      positive: health === "healthy",
      label: {
        healthy: "Healthy",
        unhealthy: "Unhealthy",
        starting: "Health check starting",
        unknown: "Health unknown",
        none: "No health status reported",
      }[health],
    },
  ];
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <InlineLink className="min-w-0" href={href}>
        <TooltipText className="block truncate" tabIndex={-1} tooltip={name}>
          {name}
        </TooltipText>
      </InlineLink>
      <span className="inline-flex shrink-0 items-center gap-1">
        {indicators.map(({ icon, positive, label }) => (
          <TooltipText
            key={label}
            aria-label={label}
            tooltip={label}
            className={`inline-flex size-5 shrink-0 items-center justify-center leading-none ${positive ? "text-success-soft-foreground" : "text-danger-soft-foreground"}`}
            role="img"
          >
            <HugeiconsIcon aria-hidden="true" className="size-4" icon={icon} />
          </TooltipText>
        ))}
      </span>
    </span>
  );
}

const resourceTypes = {
  postgres: { label: "PostgreSQL", logo: "/resource-types/postgres.png" },
  redis: { label: "Redis", logo: "/resource-types/redis.png" },
  image: { label: "Image", logo: "/resource-types/image.png" },
} satisfies Record<Resource["kind"], { label: string; logo: string }>;

export function ResourceIdentity({ resource }: { resource: Resource }) {
  const type = resourceTypes[resource.kind];
  return (
    <span className="inline-flex min-w-0 items-center gap-3">
      <Image
        alt=""
        className="size-8 shrink-0 object-contain"
        height={32}
        width={32}
        src={type.logo}
      />
      <span className="grid min-w-0 gap-1">
        <DeployableName
          autoDeploy={Boolean(resource.config.autoDeploy)}
          name={resource.name}
          href={`/sources/${resource.sourceId}/resources/${resource.id}`}
          exposed={Boolean(resource.config.domains?.primary)}
          health={resource.runtimeState.healthStatus}
        />
        <span className="text-xs text-muted">{type.label}</span>
      </span>
    </span>
  );
}

export function ServerIpLink({
  ip,
  hardware,
  serverId,
}: {
  ip: string;
  hardware?: Server["hardware"];
  serverId?: string;
}) {
  const label = (
    <span className="grid min-w-0 gap-1">
      <span className="inline-flex items-center gap-2 whitespace-nowrap tabular-nums">
        <HugeiconsIcon
          aria-hidden="true"
          className="size-4 shrink-0 text-muted"
          icon={ServerStack01Icon}
        />
        <span>{ip}</span>
      </span>
      <span className="text-xs font-normal text-muted">
        <ServerHardwareDescription hardware={hardware} />
      </span>
    </span>
  );
  return serverId ? (
    <InlineLink href={`/servers/${serverId}`}>{label}</InlineLink>
  ) : (
    label
  );
}

function getRuntimeByDeployableId(capacities: RuntimeCapacity[]) {
  return new Map(
    capacities.flatMap((capacity) =>
      capacity.runtimes.map((runtime) => [runtime.id, runtime] as const),
    ),
  );
}

function getServersByIp(servers: Server[]) {
  return new Map(servers.map((server) => [server.canonicalIp, server]));
}
