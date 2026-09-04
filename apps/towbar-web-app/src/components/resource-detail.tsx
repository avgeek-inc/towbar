"use client";

import {
  DatabaseIcon,
  FileViewIcon,
  Rocket01Icon,
  ServerStack01Icon,
  Settings01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import type {
  Deployment,
  Release,
  Resource,
} from "@workspace/towbar-web-client";
import { Attributes } from "@workspace/web-design-system/data-display/attributes";
import { TypographyCode } from "@workspace/web-design-system/typography/typography";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import { StatusBadge } from "@workspace/towbar-web-ui/status-badge";
import { getDeploymentDisplayStatus } from "@/lib/deployment-status";

import { ActionButton, DashboardPage, PageTabs } from "@/components/page-parts";
import { useApiQuery } from "@/hooks/use-api-query";
import { api } from "@/lib/api";
import { formatDate } from "./dashboard-overview";
import { DeploymentTable, formatDeploymentTrigger } from "./deployment-table";
import { ResourceBackupConfiguration } from "./resource-backup-configuration";
import { ResponsiveSubtabs } from "./responsive-subtabs";
import { ResourceSecrets } from "./app-secrets";
import { useSourceBreadcrumbs } from "./source-breadcrumbs";
import { DeployableActionsMenu, RuntimeLogs } from "./runtime-operations";
import { AutoDeployControlEditor } from "./auto-deploy-control";

type ResourceRecord = Resource & {
  serverId: string;
  serverSsh: {
    port: number;
    username: string;
  };
};

export function ResourceDetail() {
  const { resourceId, sourceId } = useParams<{
    resourceId: string;
    sourceId: string;
  }>();
  const router = useRouter();
  const breadcrumbAncestors = useSourceBreadcrumbs(sourceId, {
    href: `/sources/${sourceId}?section=resources`,
    label: "Resources",
  });
  const resource = useApiQuery<{
    resource: ResourceRecord;
  }>(`/v1/core/resources/${resourceId}`);
  const deployments = useApiQuery<{ deployments: Deployment[] }>(
    `/v1/core/resources/${resourceId}/deployments`,
    5_000,
  );
  const releases = useApiQuery<{ releases: Release[] }>(
    `/v1/core/resources/${resourceId}/releases`,
  );
  const error = resource.error ?? deployments.error ?? releases.error;

  if (error) {
    return (
      <DashboardPage breadcrumbAncestors={breadcrumbAncestors} title="Resource">
        <QueryError message={error} />
      </DashboardPage>
    );
  }
  if (!resource.data || !deployments.data || !releases.data) {
    return (
      <DashboardPage breadcrumbAncestors={breadcrumbAncestors} title="Resource">
        <QueryLoading />
      </DashboardPage>
    );
  }

  const item = resource.data.resource;
  if (item.sourceId !== sourceId) {
    return (
      <DashboardPage breadcrumbAncestors={breadcrumbAncestors} title="Resource">
        <QueryError
          message="This Resource does not belong to the selected Source."
          retryable={false}
        />
      </DashboardPage>
    );
  }

  const previous = releases.data.releases.find(
    (release) => release.status === "previous",
  );
  const orderedDeployments = [...deployments.data.deployments].sort(
    (left, right) =>
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );
  const latestDeployment = orderedDeployments[0];
  const lifecycleStatus = getResourceLifecycleStatus(item);
  const tabs = [
    {
      value: "overview",
      label: "Overview",
      icon: <HugeiconsIcon icon={DatabaseIcon} />,
      content: (
        <div className="grid gap-8 lg:grid-cols-2">
          <Attributes columns={2} title="Resource status" variant="card">
            <Attributes.Item label="Lifecycle">
              <StatusBadge status={lifecycleStatus} />
            </Attributes.Item>
            <Attributes.Item label="Type">
              {formatResourceKind(item.kind)}
            </Attributes.Item>
            <Attributes.Item label="Health">
              <StatusBadge
                status={
                  item.serverReady
                    ? item.runtimeState.healthStatus
                    : "server_setup_pending"
                }
              />
            </Attributes.Item>
            <Attributes.Item label="Running state">
              <StatusBadge status={item.runtimeState.observedState} />
            </Attributes.Item>
            <Attributes.Item label="Configuration">
              <StatusBadge status={item.runtimeState.driftStatus} />
            </Attributes.Item>
            <Attributes.Item label="Server setup">
              <StatusBadge status={item.serverReady ? "ready" : "pending"} />
            </Attributes.Item>
            <Attributes.Item
              icon={<HugeiconsIcon icon={ServerStack01Icon} />}
              label="Server"
            >
              {item.serverIp}
            </Attributes.Item>
            <Attributes.Item label="Last checked">
              {item.runtimeState.checkedAt
                ? formatDate(item.runtimeState.checkedAt)
                : "Not checked yet"}
            </Attributes.Item>
          </Attributes>
          <Attributes columns={2} title="Latest deployment" variant="card">
            <Attributes.Item label="Status">
              {latestDeployment ? (
                <StatusBadge
                  status={getDeploymentDisplayStatus(latestDeployment)}
                />
              ) : (
                "Not deployed"
              )}
            </Attributes.Item>
            <Attributes.Item label="Commit">
              {latestDeployment ? (
                <TypographyCode title={latestDeployment.commitSha}>
                  {latestDeployment.commitSha.slice(0, 12)}
                </TypographyCode>
              ) : (
                "None"
              )}
            </Attributes.Item>
            <Attributes.Item label="Requested">
              {latestDeployment
                ? formatDate(latestDeployment.createdAt)
                : "Not requested"}
            </Attributes.Item>
            <Attributes.Item label="Trigger">
              {latestDeployment
                ? formatDeploymentTrigger(latestDeployment.trigger)
                : "None"}
            </Attributes.Item>
          </Attributes>
        </div>
      ),
    },
    {
      value: "deployments",
      label: "Deployments",
      icon: <HugeiconsIcon icon={Rocket01Icon} />,
      indicator: {
        label: String(orderedDeployments.length),
        variant: "secondary" as const,
      },
      content: (
        <DeploymentTable
          deployableName={item.name}
          deployments={orderedDeployments}
          emptyDescription="Use Deploy when this resource is ready."
        />
      ),
    },
    {
      value: "logs",
      label: "Logs",
      icon: <HugeiconsIcon icon={FileViewIcon} />,
      content: (
        <RuntimeLogs
          active={!item.archivedAt && item.serverReady}
          deployableId={resourceId}
          type="resource"
        />
      ),
    },
    {
      value: "settings",
      label: "Settings",
      icon: <HugeiconsIcon icon={Settings01Icon} />,
      content: <ResourceSettings item={item} resourceId={resourceId} />,
    },
  ];

  return (
    <DashboardPage
      actions={
        !item.archivedAt ? (
          <div className="flex flex-wrap justify-end gap-2">
            <DeployableActionsMenu
              active={item.serverReady}
              deployableId={resourceId}
              previousReleaseId={previous?.id}
              runtimeState={item.runtimeState}
              sourceId={sourceId}
              type="resource"
            />
            <ActionButton
              action={() =>
                api.post<{ deployment: Deployment }>(
                  `/v1/core/resources/${resourceId}/actions/deploy`,
                  undefined,
                  { "Idempotency-Key": crypto.randomUUID() },
                )
              }
              onSuccess={(result) =>
                router.push(
                  `/sources/${sourceId}/deployments/${result.deployment.id}`,
                )
              }
              pendingLabel="Queueing…"
              isDisabled={!item.serverReady}
              success="Resource deployment queued"
              variant="primary"
            >
              Deploy
            </ActionButton>
          </div>
        ) : undefined
      }
      badge={
        <StatusBadge
          status={
            lifecycleStatus === "active"
              ? item.runtimeState.healthStatus
              : lifecycleStatus
          }
        />
      }
      breadcrumbAncestors={breadcrumbAncestors}
      title={item.name}
      titleContent={
        <span className="inline-flex min-w-0 items-center gap-2">
          <HugeiconsIcon
            aria-hidden="true"
            className="size-6 shrink-0"
            icon={DatabaseIcon}
          />
          <span className="truncate" title={item.name}>
            {item.name}
          </span>
        </span>
      }
    >
      <PageTabs defaultValue="overview" tabs={tabs} />
    </DashboardPage>
  );
}

function ResourceSettings({
  item,
  resourceId,
}: {
  item: ResourceRecord;
  resourceId: string;
}) {
  const requestedSettings = useSearchParams().get("settings");
  const tabs: Array<{ content: ReactNode; label: string; value: string }> = [
    {
      value: "image",
      label: "Image",
      content: (
        <Attributes columns={2} title="Image configuration" variant="card">
          <Attributes.Item label="Image">
            <TypographyCode className="break-all">
              {item.config.image}
            </TypographyCode>
          </Attributes.Item>
          <Attributes.Item label="Resource type">
            {formatResourceKind(item.kind)}
          </Attributes.Item>
          <Attributes.Item label="Source branch">
            {item.config.sourceBranch ?? "main"}
          </Attributes.Item>
          <Attributes.Item label="Source revision">
            <TypographyCode title={item.sourceRevision}>
              {item.sourceRevision.slice(0, 12)}
            </TypographyCode>
          </Attributes.Item>
          <Attributes.Item label="Command">
            {item.config.container.command.length ? (
              <TypographyCode className="break-all">
                {item.config.container.command.join(" ")}
              </TypographyCode>
            ) : (
              "Image default"
            )}
          </Attributes.Item>
        </Attributes>
      ),
    },
    {
      value: "runtime",
      label: "Runtime",
      content: (
        <Attributes columns={2} title="Container configuration" variant="card">
          <Attributes.Item label="Container port">
            {item.config.container.port ?? "Not exposed"}
          </Attributes.Item>
          <Attributes.Item label="Network">
            {item.config.container.network ? (
              <TypographyCode>{item.config.container.network}</TypographyCode>
            ) : (
              "Default bridge"
            )}
          </Attributes.Item>
          <Attributes.Item label="CPU limit">
            {item.config.container.resources.cpus}
          </Attributes.Item>
          <Attributes.Item label="Memory limit">
            {item.config.container.resources.memory}
          </Attributes.Item>
          <Attributes.Item label="Health check">
            {renderHealth(item.config.health)}
          </Attributes.Item>
          <Attributes.Item label="Persistent volumes">
            {renderVolumes(item.config.container.volumes)}
          </Attributes.Item>
        </Attributes>
      ),
    },
    ...((item.config.container.networkAlias || item.config.access?.sshTunnel) &&
    item.config.container.port
      ? [
          {
            value: "connection",
            label: "Connection",
            content: <ResourceConnectionDetails item={item} />,
          },
        ]
      : []),
    ...(item.kind === "image"
      ? []
      : [
          {
            value: "backups",
            label: "Backups",
            content: (
              <ResourceBackupConfiguration
                active={!item.archivedAt && item.serverReady}
                resource={item}
              />
            ),
          },
        ]),
    {
      value: "delivery",
      label: "Delivery",
      content: (
        <Attributes columns={2} title="Deployment configuration" variant="card">
          <Attributes.Item label="Auto-deploy">
            {item.config.autoDeploy ? "Enabled" : "Disabled"}
          </Attributes.Item>
          <Attributes.Item label="Primary domain">
            {item.config.domains?.primary ?? "Not configured"}
          </Attributes.Item>
          <Attributes.Item label="Redirects">
            {item.config.domains?.redirects.length
              ? item.config.domains.redirects.map((redirect) => (
                  <span className="block" key={redirect.host}>
                    {redirect.host} · {redirect.status}
                  </span>
                ))
              : "None"}
          </Attributes.Item>
          <Attributes.Item label="TLS">
            {item.config.tls?.mode === "cloudflare-dns"
              ? "Cloudflare DNS"
              : item.config.tls?.mode === "direct"
                ? "Direct"
                : "Not configured"}
          </Attributes.Item>
        </Attributes>
      ),
    },
    {
      value: "auto-deploy",
      label: "Auto-deploy",
      content: <AutoDeployControlEditor id={resourceId} type="resource" />,
    },
    {
      value: "secrets",
      label: "Secrets",
      content: (
        <ResourceSecrets
          canDeploy={!item.archivedAt && item.serverReady}
          resourceId={resourceId}
          sourceId={item.sourceId}
        />
      ),
    },
  ];

  return (
    <ResponsiveSubtabs
      ariaLabel="Resource settings"
      defaultSelectedKey={requestedSettings === "secrets" ? "secrets" : "image"}
      tabs={tabs}
    />
  );
}

function ResourceConnectionDetails({ item }: { item: ResourceRecord }) {
  return (
    <Attributes columns={2} title="Connection details" variant="card">
      <Attributes.Item label="Private host">
        {item.config.container.networkAlias ? (
          <TypographyCode>{item.config.container.networkAlias}</TypographyCode>
        ) : (
          "Not configured"
        )}
      </Attributes.Item>
      <Attributes.Item label="Private port">
        <TypographyCode>{item.config.container.port}</TypographyCode>
      </Attributes.Item>
      {item.config.access?.sshTunnel ? (
        <>
          <Attributes.Item label="Service host">
            <TypographyCode>127.0.0.1</TypographyCode>
          </Attributes.Item>
          <Attributes.Item label="Service port">
            <TypographyCode>
              {item.config.access.sshTunnel.hostPort}
            </TypographyCode>
          </Attributes.Item>
          <Attributes.Item label="SSH host">
            <TypographyCode>{item.serverIp}</TypographyCode>
          </Attributes.Item>
          <Attributes.Item label="SSH port">
            <TypographyCode>{item.serverSsh.port}</TypographyCode>
          </Attributes.Item>
          <Attributes.Item label="SSH username">
            <TypographyCode>{item.serverSsh.username}</TypographyCode>
          </Attributes.Item>
          <Attributes.Item label="Transport">SSH tunnel</Attributes.Item>
        </>
      ) : null}
    </Attributes>
  );
}

function renderHealth(health: Resource["config"]["health"]) {
  if (health.type === "http") {
    return (
      <span className="grid gap-1">
        <TypographyCode>{health.path}</TypographyCode>
        <span className="typography--body-xs font-normal text-muted">
          HTTP · {health.timeoutSeconds} second timeout
        </span>
      </span>
    );
  }
  if (health.type === "command") {
    return (
      <span className="grid gap-1">
        <TypographyCode className="break-all">
          {health.command.join(" ")}
        </TypographyCode>
        <span className="typography--body-xs font-normal text-muted">
          {health.timeoutSeconds} second timeout
        </span>
      </span>
    );
  }
  return `Container health · ${health.timeoutSeconds} second timeout`;
}

function renderVolumes(volumes: Resource["config"]["container"]["volumes"]) {
  if (!volumes.length) return "None";
  return (
    <span className="grid gap-1.5">
      {volumes.map((volume) => (
        <span
          className="flex min-w-0 flex-wrap items-center gap-1.5"
          key={volume.name}
        >
          <TypographyCode>{volume.name}</TypographyCode>
          <span aria-hidden="true" className="text-muted">
            →
          </span>
          <TypographyCode>{volume.mountPath}</TypographyCode>
        </span>
      ))}
    </span>
  );
}

function formatResourceKind(kind: Resource["kind"]) {
  if (kind === "postgres") return "PostgreSQL";
  if (kind === "redis") return "Redis";
  return "Docker image";
}

function getResourceLifecycleStatus(item: ResourceRecord) {
  if (item.archivedAt) return "archived";
  if (!item.serverReady) return "server_setup_pending";
  return "active";
}
