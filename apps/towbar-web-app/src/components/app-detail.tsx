"use client";
import { AppJobs } from "./app-jobs";
import { AppStorage } from "./app-storage";
import { useAccess } from "./access-context";
import { IntegrationProviderLogo } from "./integration-provider-logo";
import { useDetailNavigation } from "@/hooks/use-detail-navigation";
import { DeployableVulnerabilities } from "./deployable-vulnerabilities";
import { InstanceEnvironmentChoice } from "./instance-environment-choice";
import {
  ScoutAlertRules,
  ScoutCompareDeployments,
  ScoutIncidents,
  ScoutPerformance,
} from "./scout-panel";

import {
  Activity01Icon,
  Clock01Icon,
  Alert02Icon,
  AlertCircleIcon,
  SecurityCheckIcon,
  DashboardCircleIcon,
  FileViewIcon,
  GitBranchIcon,
  GitCompareIcon,
  PackageIcon,
  Rocket01Icon,
  ServerStack01Icon,
  Settings01Icon,
  Key01Icon,
  Notification01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useParams, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import type {
  App,
  Deployment,
  Release,
  RuntimeState,
  Source,
} from "@workspace/towbar-web-client";
import { Attributes } from "@workspace/web-design-system/data-display/attributes";
import { TypographyCode } from "@workspace/web-design-system/typography/typography";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import { StatusBadge } from "@workspace/towbar-web-ui/status-badge";
import { getDeploymentDisplayStatus } from "@/lib/deployment-status";
import { deploymentHref } from "@/lib/deployment-route";

import {
  ActionButton,
  appsBreadcrumb,
  DashboardPage,
  InlineLink,
  PageTabs,
} from "@/components/page-parts";
import { useApiQuery } from "@/hooks/use-api-query";
import { api } from "@/lib/api";
import { formatDate } from "./dashboard-overview";
import { DeploymentTable, deploymentStatusTooltip } from "./deployment-table";
import { AppSecrets } from "./app-secrets";
import { PreviewEnvironments } from "./preview-environments";
import { ResponsiveSubtabs } from "./responsive-subtabs";
import { DeployableActionsMenu, RuntimeLogs } from "./runtime-operations";
import { AutoDeployControlEditor } from "./auto-deploy-control";
import { DomainLink } from "./domain-link";
import { DeployableReadiness } from "./deployable-readiness";
import { AppLogo } from "./deployable-identity";
import { FirstDeployment } from "./first-deployment";
import { EnvironmentChip } from "./environment-chip";
import { DeployableNotifications } from "./deployable-notifications";

type AppRecord = App & {
  serverId: string;
};

function tunnelStatusTooltip(runtime: RuntimeState) {
  const details = [
    runtime.ingressContainerName
      ? `Runtime ${runtime.ingressContainerName}.`
      : null,
    runtime.ingressImage ? `Image ${runtime.ingressImage}.` : null,
    runtime.ingressRestartCount !== null
      ? `${runtime.ingressRestartCount} restart${runtime.ingressRestartCount === 1 ? "" : "s"} observed.`
      : null,
  ].filter(Boolean);
  return details.length
    ? details.join(" ")
    : "Run a server check to inspect the managed Cloudflare Tunnel runtime.";
}

export function AppDetail() {
  const detailNavigation = useDetailNavigation();
  const { appId } = useParams<{
    appId: string;
  }>();
  const router = useRouter();
  const { can } = useAccess();
  const app = useApiQuery<{ app: App & { serverId: string } }>(
    `/v1/core/apps/${appId}`,
  );
  const source = useApiQuery<{ source: Source }>(
    app.data?.app.sourceId ? `/v1/core/sources/${app.data.app.sourceId}` : null,
  );
  const deployments = useApiQuery<{ deployments: Deployment[] }>(
    `/v1/core/apps/${appId}/deployments`,
    5_000,
  );
  const releases = useApiQuery<{ releases: Release[] }>(
    `/v1/core/apps/${appId}/releases`,
  );
  const error =
    app.error ?? deployments.error ?? releases.error ?? source.error;
  if (error)
    return (
      <DashboardPage
        icon={DashboardCircleIcon}
        breadcrumbAncestors={appsBreadcrumb}
        title="App"
      >
        <QueryError message={error} />
      </DashboardPage>
    );
  if (!app.data || !deployments.data || !releases.data || !source.data)
    return <QueryLoading variant="detail" />;

  const item = app.data.app;
  const usesCloudflareTunnel =
    item.config.kind === "compose"
      ? Object.values(item.config.services).some(
          (service) => service.ingress?.type === "cloudflare-tunnel",
        )
      : item.config.ingress?.type === "cloudflare-tunnel";
  const previous = releases.data.releases.find(
    (release) => release.status === "previous",
  );
  const orderedDeployments = [...deployments.data.deployments].sort(
    (left, right) =>
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );
  const latestDeployment = orderedDeployments[0];
  const lifecycleStatus = getAppLifecycleStatus(item);
  const faviconDomain =
    item.config.domains?.primary ?? item.config.domains?.redirects[0]?.host;
  const appLogo = (
    <AppLogo
      key={faviconDomain ?? "no-domain"}
      domain={faviconDomain}
      size="small"
    />
  );
  return (
    <DashboardPage
      icon={DashboardCircleIcon}
      actions={
        detailNavigation.section === "overview" &&
        Boolean(latestDeployment) &&
        !item.archivedAt &&
        can("deployment.create") ? (
          <div className="flex flex-wrap justify-end gap-2">
            <DeployableActionsMenu
              active={item.serverReady}
              deployableId={appId}
              previousReleaseId={previous?.id}
              runtimeState={item.runtimeState}
              services={
                item.config.kind === "compose"
                  ? (releases.data.releases.find(
                      (release) => release.status === "current",
                    )?.composeServices ?? Object.keys(item.config.services))
                  : undefined
              }
              type="app"
            />
            {Object.keys(item.config.externalSecrets ?? {}).length > 0 ? (
              <ActionButton
                confirm={{
                  title: "Refresh external secrets?",
                  description:
                    "Queue a new deployment that resolves one consistent snapshot of the current external secret versions. A retry of the existing deployment keeps its original snapshot.",
                  actionLabel: "Refresh and deploy",
                }}
                action={() =>
                  api.post<{ deployment: Deployment }>(
                    `/v1/core/apps/${appId}/actions/refresh-external-secrets`,
                    undefined,
                    { "Idempotency-Key": crypto.randomUUID() },
                  )
                }
                onSuccess={(result) =>
                  router.push(deploymentHref(result.deployment))
                }
                pendingLabel="Queueing…"
                isDisabled={!item.serverReady}
                success="External secret refresh queued"
              >
                <HugeiconsIcon
                  aria-hidden="true"
                  icon={Key01Icon}
                  className="size-3.5 shrink-0"
                />
                Refresh secrets
              </ActionButton>
            ) : null}
            <ActionButton
              confirm={{
                title: "Deploy this app?",
                description:
                  "Queue a new app deployment. A successful deployment will replace the running release.",
                actionLabel: "Deploy app",
              }}
              action={() =>
                api.post<{ deployment: Deployment }>(
                  `/v1/core/apps/${appId}/actions/deploy`,
                  undefined,
                  { "Idempotency-Key": crypto.randomUUID() },
                )
              }
              onSuccess={(result) =>
                router.push(deploymentHref(result.deployment))
              }
              pendingLabel="Queueing…"
              isDisabled={!item.serverReady}
              success="Deployment queued"
              variant="primary"
            >
              <HugeiconsIcon
                aria-hidden="true"
                icon={Rocket01Icon}
                className="size-4 shrink-0"
              />
              Deploy
            </ActionButton>
          </div>
        ) : undefined
      }
      breadcrumbAncestors={appsBreadcrumb}
      breadcrumbSwitcher={{ id: appId, kind: "apps" }}
      title={item.name}
      titleIcon={appLogo}
    >
      <InstanceEnvironmentChoice item={item} kind="apps" />
      {detailNavigation.section === "overview" ? (
        <DeployableReadiness
          ready={item.serverReady}
          serverId={item.serverId}
          serverIp={item.serverIp}
        />
      ) : null}
      <PageTabs
        defaultValue="overview"
        tabs={[
          {
            value: "overview",
            label: "Overview",
            icon: <HugeiconsIcon icon={DashboardCircleIcon} />,
            content: (
              <div className="content-grid lg:grid-cols-2">
                <Attributes
                  icon={<HugeiconsIcon icon={DashboardCircleIcon} />}
                  columns={2}
                  title="Current state"
                  variant="card"
                >
                  <Attributes.Item label="Lifecycle">
                    <StatusBadge
                      status={lifecycleStatus}
                      label={item.serverReady ? undefined : "Setup pending"}
                    />
                  </Attributes.Item>
                  <Attributes.Item label="Health">
                    {item.serverReady ? (
                      <StatusBadge status={item.runtimeState.healthStatus} />
                    ) : (
                      "Not checked"
                    )}
                  </Attributes.Item>
                  <Attributes.Item label="Runtime">
                    <StatusBadge
                      context="runtime"
                      status={item.runtimeState.observedState}
                    />
                  </Attributes.Item>
                  <Attributes.Item label="Configuration">
                    <StatusBadge status={item.runtimeState.driftStatus} />
                  </Attributes.Item>
                  {usesCloudflareTunnel ? (
                    <Attributes.Item label="Cloudflare Tunnel">
                      <StatusBadge
                        status={item.runtimeState.ingressStatus}
                        tooltip={tunnelStatusTooltip(item.runtimeState)}
                      />
                    </Attributes.Item>
                  ) : null}
                  <Attributes.Item label="Environment">
                    {item.environment ? (
                      <EnvironmentChip name={item.environment.name} />
                    ) : (
                      "Unmapped"
                    )}
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
                  <Attributes.Item label="Domain">
                    {item.config.domains?.primary ? (
                      <DomainLink domain={item.config.domains.primary}>
                        {item.config.domains.primary}
                      </DomainLink>
                    ) : (
                      "Not configured"
                    )}
                  </Attributes.Item>
                  <Attributes.Item
                    icon={<IntegrationProviderLogo provider="github" />}
                    label="Repository"
                  >
                    <InlineLink href={`/repositories/${item.sourceId}`}>
                      {source.data.source.repositoryName}
                    </InlineLink>
                  </Attributes.Item>
                  <Attributes.Item
                    icon={<HugeiconsIcon icon={GitBranchIcon} />}
                    label="Branch"
                  >
                    <span className="break-words font-mono">
                      {item.config.sourceBranch ?? "main"}
                    </span>
                  </Attributes.Item>
                </Attributes>
                {latestDeployment ? (
                  <Attributes
                    icon={<HugeiconsIcon icon={Rocket01Icon} />}
                    columns={2}
                    title="Last deployment attempt"
                    variant="card"
                  >
                    <Attributes.Item label="Status">
                      <StatusBadge
                        status={getDeploymentDisplayStatus(latestDeployment)}
                        tooltip={deploymentStatusTooltip(latestDeployment)}
                      />
                    </Attributes.Item>
                    <Attributes.Item label="Commit">
                      <TypographyCode title={latestDeployment.commitSha}>
                        {latestDeployment.commitSha.slice(0, 12)}
                      </TypographyCode>
                    </Attributes.Item>
                    <Attributes.Item label="Requested">
                      {formatDate(latestDeployment.createdAt)}
                    </Attributes.Item>
                    <Attributes.Item label="Auto-deploy">
                      {item.config.autoDeploy ? "Enabled" : "Disabled"}
                    </Attributes.Item>
                  </Attributes>
                ) : item.serverReady ? (
                  <FirstDeployment
                    canDeploy={can("deployment.create")}
                    deployableId={appId}
                    type="app"
                  />
                ) : null}
              </div>
            ),
          },
          {
            value: "performance",
            label: "Performance",
            contentOwnsTitle: true,
            group: "Monitor",
            icon: <HugeiconsIcon icon={Activity01Icon} />,
            content: (
              <ScoutPerformance
                path={`/v1/core/apps/${appId}/metrics`}
                serverId={item.serverId}
                workload
              />
            ),
          },
          {
            value: "alerts",
            label: "Alerts",
            contentOwnsTitle: true,
            group: "Monitor",
            icon: <HugeiconsIcon icon={Alert02Icon} />,
            content: (
              <ScoutAlertRules serverId={item.serverId} deployableId={appId} />
            ),
          },
          {
            value: "incidents",
            label: "Incidents",
            contentOwnsTitle: true,
            group: "Monitor",
            icon: <HugeiconsIcon icon={AlertCircleIcon} />,
            content: (
              <ScoutIncidents serverId={item.serverId} deployableId={appId} />
            ),
          },
          {
            value: "notifications",
            label: "Notifications",
            group: "Monitor",
            icon: <HugeiconsIcon icon={Notification01Icon} />,
            content: (
              <DeployableNotifications
                notifications={item.config.notifications}
              />
            ),
          },
          {
            value: "compare-deployments",
            label: "Compare deployments",
            sidebarLabel: "Compare",
            group: "Monitor",
            icon: <HugeiconsIcon icon={GitCompareIcon} />,
            content: <ScoutCompareDeployments deployableId={appId} />,
          },
          {
            value: "vulnerabilities",
            label: "Vulnerabilities",
            group: "Monitor",
            icon: <HugeiconsIcon icon={SecurityCheckIcon} className="size-4" />,
            content: <DeployableVulnerabilities appId={appId} kind="app" />,
          },
          {
            value: "deployments",
            label: "Deployments",
            icon: <HugeiconsIcon icon={Rocket01Icon} />,
            indicator: {
              label: String(orderedDeployments.length),
              variant: "secondary",
            },
            content: (
              <DeploymentTable
                deployableName={item.name}
                deployments={orderedDeployments}
                emptyDescription="Use Deploy when this app is ready."
              />
            ),
          },
          ...(item.config.preview?.enabled
            ? [
                {
                  value: "previews",
                  label: "Previews",
                  icon: <HugeiconsIcon icon={GitBranchIcon} />,
                  content: (
                    <PreviewEnvironments
                      appId={appId}
                      sourceId={item.sourceId}
                    />
                  ),
                },
              ]
            : []),
          {
            value: "logs",
            label: "Logs",
            icon: <HugeiconsIcon icon={FileViewIcon} />,
            content: (
              <RuntimeLogs
                active={!item.archivedAt && item.serverReady}
                deployableId={appId}
                hasIngress={usesCloudflareTunnel}
                services={
                  item.config.kind === "compose"
                    ? (releases.data.releases.find(
                        (release) => release.status === "current",
                      )?.composeServices ?? Object.keys(item.config.services))
                    : undefined
                }
                type="app"
              />
            ),
          },
          {
            value: "jobs",
            label: "Scheduled jobs",
            icon: <HugeiconsIcon icon={Clock01Icon} />,
            content: <AppJobs appId={appId} />,
          },
          {
            value: "storage",
            label: "Storage",
            icon: <HugeiconsIcon icon={PackageIcon} />,
            content: <AppStorage appId={appId} />,
          },
          {
            value: "settings",
            label: "Settings",
            icon: <HugeiconsIcon icon={Settings01Icon} />,
            content: <AppSettings appId={appId} item={item} />,
          },
        ]}
      />
    </DashboardPage>
  );
}

function AppSettings({ appId, item }: { appId: string; item: AppRecord }) {
  const requestedSettings = useDetailNavigation().settings;
  const tabs: Array<{
    content: ReactNode;
    icon: ReactNode;
    label: string;
    value: string;
  }> = [
    {
      value: "configuration",
      label: "Configuration",
      icon: <HugeiconsIcon icon={Settings01Icon} />,
      content: <AppConfiguration item={item} />,
    },
    ...(item.config.preview?.enabled
      ? [
          {
            value: "preview",
            label: "Preview",
            icon: <HugeiconsIcon icon={Rocket01Icon} />,
            content: (
              <Attributes
                icon={<HugeiconsIcon icon={Settings01Icon} />}
                columns={2}
                title="Preview configuration"
                variant="card"
              >
                <Attributes.Item label="Base domain">
                  <DomainLink domain={item.config.preview.domain}>
                    {item.config.preview.domain}
                  </DomainLink>
                </Attributes.Item>
                <Attributes.Item label="Time to live">
                  {item.config.preview.ttlHours} hours
                </Attributes.Item>
              </Attributes>
            ),
          },
        ]
      : []),
    {
      value: "auto-deploy",
      label: "Auto-deploy",
      icon: <HugeiconsIcon icon={GitBranchIcon} />,
      content: <AutoDeployControlEditor id={appId} type="app" />,
    },
    {
      value: "secrets",
      label: "Secrets",
      icon: <HugeiconsIcon icon={Key01Icon} />,
      content: <AppSecrets appId={appId} />,
    },
  ];

  return (
    <ResponsiveSubtabs
      ariaLabel="App settings"
      defaultSelectedKey={
        requestedSettings === "secrets" ? "secrets" : "configuration"
      }
      tabs={tabs}
    />
  );
}

function AppConfiguration({ item }: { item: AppRecord }) {
  return (
    <div className="content-grid lg:grid-cols-2 lg:items-start">
      <Attributes
        icon={<HugeiconsIcon icon={PackageIcon} />}
        columns={2}
        title="Build configuration"
        variant="card"
      >
        {item.config.kind === "compose" ? (
          <>
            <Attributes.Item label="Compose file">
              <TypographyCode className="break-all">
                {item.config.file}
              </TypographyCode>
            </Attributes.Item>
            <Attributes.Item label="Strategy">
              {item.config.strategy}
            </Attributes.Item>
            <Attributes.Item label="Profiles">
              {item.config.profiles.join(", ") || "Default"}
            </Attributes.Item>
          </>
        ) : (
          <Attributes.Item label="Build mode">
            {item.config.deployment?.type ?? "dockerfile"}
          </Attributes.Item>
        )}
        <Attributes.Item label="Repository branch">
          {item.config.sourceBranch ?? "main"}
        </Attributes.Item>
        <Attributes.Item label="Repository revision">
          <TypographyCode title={item.sourceRevision}>
            {item.sourceRevision.slice(0, 12)}
          </TypographyCode>
        </Attributes.Item>
      </Attributes>
      <Attributes
        icon={<HugeiconsIcon icon={PackageIcon} />}
        columns={2}
        title="Container configuration"
        variant="card"
      >
        <Attributes.Item label="Container port">
          {item.config.container.port}
        </Attributes.Item>
        <Attributes.Item label="Network">
          {item.config.container.network ? (
            <TypographyCode>{item.config.container.network}</TypographyCode>
          ) : (
            "Default bridge"
          )}
        </Attributes.Item>
        <Attributes.Item label="CPU limit">
          {item.config.container.resources?.cpus ?? "Docker default"}
        </Attributes.Item>
        <Attributes.Item label="Memory limit">
          {item.config.container.resources?.memory ?? "Docker default"}
        </Attributes.Item>
        <Attributes.Item label="Health endpoint">
          <TypographyCode>{item.config.health.path}</TypographyCode>
        </Attributes.Item>
        <Attributes.Item label="Health timeout">
          {item.config.health.timeoutSeconds} seconds
        </Attributes.Item>
      </Attributes>
      <Attributes
        icon={<HugeiconsIcon icon={Rocket01Icon} />}
        columns={2}
        title="Deployment configuration"
        variant="card"
      >
        <Attributes.Item label="Auto-deploy">
          {item.config.autoDeploy ? "Enabled" : "Disabled"}
        </Attributes.Item>
        <Attributes.Item label="Deployment inputs">
          {item.config.autoDeploy
            ? item.config.deploymentInputs?.length
              ? renderCodeList(item.config.deploymentInputs)
              : "Every Repository commit"
            : "Not used"}
        </Attributes.Item>
        <Attributes.Item label="Primary domain">
          {item.config.domains?.primary ? (
            <DomainLink domain={item.config.domains.primary}>
              {item.config.domains.primary}
            </DomainLink>
          ) : (
            "Not configured"
          )}
        </Attributes.Item>
        <Attributes.Item label="Redirects">
          {item.config.domains?.redirects.length
            ? item.config.domains.redirects.map((redirect) => (
                <span className="flex items-center gap-1" key={redirect.host}>
                  <DomainLink domain={redirect.host}>
                    {redirect.host}
                  </DomainLink>
                  <span>· {redirect.status}</span>
                </span>
              ))
            : "None"}
        </Attributes.Item>
        <Attributes.Item label="Pre-deploy hook">
          {renderHook(item.config.hooks?.preDeploy)}
        </Attributes.Item>
        <Attributes.Item label="Post-deploy hook">
          {renderHook(item.config.hooks?.postDeploy)}
        </Attributes.Item>
      </Attributes>
    </div>
  );
}

function renderCodeList(values: string[] | undefined) {
  if (!values?.length) return "None";
  return (
    <span className="flex flex-wrap gap-1.5">
      {values.map((value) => (
        <TypographyCode className="break-all" key={value}>
          {value}
        </TypographyCode>
      ))}
    </span>
  );
}

function renderHook(
  hook:
    | {
        command: string[];
        secrets?: string;
        timeoutSeconds: number;
      }
    | undefined,
) {
  if (!hook) return "Not configured";
  return (
    <span className="grid gap-1">
      <TypographyCode className="break-all">
        {hook.command.join(" ")}
      </TypographyCode>
      <span className="typography--body-xs font-normal text-muted">
        {hook.timeoutSeconds} second timeout
      </span>
    </span>
  );
}

function getAppLifecycleStatus(item: AppRecord) {
  if (item.archivedAt) return "archived";
  if (!item.serverReady) return "server_setup_pending";
  return "active";
}
