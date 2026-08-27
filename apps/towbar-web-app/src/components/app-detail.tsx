"use client";

import {
  Activity01Icon,
  CodeIcon,
  DashboardCircleIcon,
  FileViewIcon,
  GitBranchIcon,
  Key01Icon,
  Rocket01Icon,
  ServerStack01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useParams, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import type { App, Deployment, Release } from "@workspace/towbar-web-client";
import { Attributes } from "@workspace/web-design-system/data-display/attributes";
import { Tabs } from "@workspace/web-design-system/navigation/tabs";
import { TypographyCode } from "@workspace/web-design-system/typography/typography";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import { StatusBadge } from "@workspace/towbar-web-ui/status-badge";
import { getDeploymentDisplayStatus } from "@/lib/deployment-status";

import { ActionButton, DashboardPage, PageTabs } from "@/components/page-parts";
import { useApiQuery } from "@/hooks/use-api-query";
import { useResponsiveTabsOrientation } from "@/hooks/use-responsive-tabs-orientation";
import { api } from "@/lib/api";
import { formatDate } from "./dashboard-overview";
import { DeploymentTable } from "./deployment-table";
import { AppSecrets } from "./app-secrets";
import { PreviewEnvironments } from "./preview-environments";
import { useSourceBreadcrumbs } from "./source-breadcrumbs";
import {
  DeployableActionsMenu,
  RuntimeLogs,
  RuntimeOverview,
} from "./runtime-operations";

type AppRecord = App & {
  serverId: string;
};

export function AppDetail() {
  const { appId, sourceId } = useParams<{
    appId: string;
    sourceId: string;
  }>();
  const router = useRouter();
  const app = useApiQuery<{ app: App & { serverId: string } }>(
    `/v1/core/apps/${appId}`,
  );
  const breadcrumbAncestors = useSourceBreadcrumbs(sourceId, {
    href: `/sources/${sourceId}?section=apps`,
    label: "Apps",
  });
  const deployments = useApiQuery<{ deployments: Deployment[] }>(
    `/v1/core/apps/${appId}/deployments`,
    5_000,
  );
  const releases = useApiQuery<{ releases: Release[] }>(
    `/v1/core/apps/${appId}/releases`,
  );
  const error = app.error ?? deployments.error ?? releases.error;
  if (error)
    return (
      <DashboardPage breadcrumbAncestors={breadcrumbAncestors} title="App">
        <QueryError message={error} />
      </DashboardPage>
    );
  if (!app.data || !deployments.data || !releases.data)
    return (
      <DashboardPage breadcrumbAncestors={breadcrumbAncestors} title="App">
        <QueryLoading />
      </DashboardPage>
    );

  const item = app.data.app;
  if (item.sourceId !== sourceId) {
    return (
      <DashboardPage breadcrumbAncestors={breadcrumbAncestors} title="App">
        <QueryError
          message="This App does not belong to the selected Source."
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
  const lifecycleStatus = getAppLifecycleStatus(item);
  return (
    <DashboardPage
      actions={
        !item.archivedAt ? (
          <div className="flex flex-wrap justify-end gap-2">
            <DeployableActionsMenu
              active={item.serverReady}
              deployableId={appId}
              previousReleaseId={previous?.id}
              runtimeState={item.runtimeState}
              sourceId={item.sourceId}
              type="app"
            />
            <ActionButton
              action={() =>
                api.post<{ deployment: Deployment }>(
                  `/v1/core/apps/${appId}/actions/deploy`,
                  undefined,
                  { "Idempotency-Key": crypto.randomUUID() },
                )
              }
              onSuccess={(result) =>
                router.push(
                  `/sources/${item.sourceId}/deployments/${result.deployment.id}`,
                )
              }
              pendingLabel="Queueing…"
              isDisabled={!item.serverReady}
              success="Deployment queued"
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
        <span className="inline-flex min-w-0 items-center gap-3">
          <HugeiconsIcon
            aria-hidden="true"
            className="size-8 shrink-0"
            icon={DashboardCircleIcon}
          />
          <span className="truncate" title={item.name}>
            {item.name}
          </span>
        </span>
      }
    >
      <PageTabs
        defaultValue="overview"
        tabs={[
          {
            value: "overview",
            label: "Overview",
            icon: <HugeiconsIcon icon={DashboardCircleIcon} />,
            content: (
              <div className="grid gap-8 lg:grid-cols-2">
                <Attributes columns={2} title="App status" variant="card">
                  <Attributes.Item label="App status">
                    <StatusBadge status={lifecycleStatus} />
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
                  <Attributes.Item label="Server setup">
                    <StatusBadge
                      status={item.serverReady ? "ready" : "pending"}
                    />
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
                    {item.config.domains?.primary ?? "Not configured"}
                  </Attributes.Item>
                </Attributes>
                <Attributes
                  columns={2}
                  title="Latest deployment"
                  variant="card"
                >
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
                  <Attributes.Item label="Auto-deploy">
                    {item.config.autoDeploy ? "Enabled" : "Disabled"}
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
                    <PreviewEnvironments appId={appId} sourceId={sourceId} />
                  ),
                },
              ]
            : []),
          {
            value: "runtime",
            label: "Runtime",
            icon: <HugeiconsIcon icon={Activity01Icon} />,
            indicator: !item.serverReady
              ? { dot: true, label: "Setup pending", variant: "warning" }
              : item.runtimeState.healthStatus === "unhealthy"
                ? { label: "Unhealthy", variant: "destructive" }
                : item.runtimeState.driftStatus === "drifted"
                  ? { dot: true, label: "Drifted", variant: "warning" }
                  : undefined,
            content: (
              <RuntimeOverview runtimeState={item.runtimeState} type="app" />
            ),
          },
          {
            value: "logs",
            label: "Logs",
            icon: <HugeiconsIcon icon={FileViewIcon} />,
            content: (
              <RuntimeLogs
                active={!item.archivedAt && item.serverReady}
                deployableId={appId}
                type="app"
              />
            ),
          },
          {
            value: "secrets",
            label: "Secrets",
            icon: <HugeiconsIcon icon={Key01Icon} />,
            content: (
              <AppSecrets
                appId={appId}
                canDeploy={!item.archivedAt && item.serverReady}
                sourceId={item.sourceId}
              />
            ),
          },
          {
            value: "configuration",
            label: "Configuration",
            icon: <HugeiconsIcon icon={CodeIcon} />,
            content: <AppConfigurationTabs item={item} />,
          },
        ]}
      />
    </DashboardPage>
  );
}

function AppConfigurationTabs({ item }: { item: AppRecord }) {
  const orientation = useResponsiveTabsOrientation();
  const tabs: Array<{ content: ReactNode; label: string; value: string }> = [
    {
      value: "build",
      label: "Build",
      content: (
        <Attributes columns={2} title="Build configuration" variant="card">
          <Attributes.Item label="Dockerfile">
            <TypographyCode className="break-all">
              {item.config.dockerfile}
            </TypographyCode>
          </Attributes.Item>
          <Attributes.Item label="Source branch">
            {item.config.sourceBranch ?? "main"}
          </Attributes.Item>
          <Attributes.Item label="Source revision">
            <TypographyCode title={item.sourceRevision}>
              {item.sourceRevision.slice(0, 12)}
            </TypographyCode>
          </Attributes.Item>
          <Attributes.Item label="Shared build secrets">
            {formatCount(
              item.config.sharedSecrets?.build.length ?? 0,
              "secret",
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
      ),
    },
    {
      value: "delivery",
      label: "Delivery",
      content: (
        <Attributes columns={2} title="Deployment configuration" variant="card">
          <Attributes.Item label="Auto-deploy">
            {item.config.autoDeploy ? "Enabled" : "Disabled"}
          </Attributes.Item>
          <Attributes.Item label="Deployment inputs">
            {item.config.autoDeploy
              ? item.config.deploymentInputs?.length
                ? renderCodeList(item.config.deploymentInputs)
                : "Every Source commit"
              : "Not used"}
          </Attributes.Item>
          <Attributes.Item label="Shared deployment secrets">
            {formatCount(
              item.config.sharedSecrets?.deployment.length ?? 0,
              "secret",
            )}
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
          <Attributes.Item label="Pre-deploy hook">
            {renderHook(item.config.hooks?.preDeploy)}
          </Attributes.Item>
          <Attributes.Item label="Post-deploy hook">
            {renderHook(item.config.hooks?.postDeploy)}
          </Attributes.Item>
        </Attributes>
      ),
    },
    ...(item.config.preview?.enabled
      ? [
          {
            value: "preview",
            label: "Preview",
            content: (
              <Attributes
                columns={2}
                title="Preview configuration"
                variant="card"
              >
                <Attributes.Item label="Base domain">
                  {item.config.preview.domain}
                </Attributes.Item>
                <Attributes.Item label="Time to live">
                  {item.config.preview.ttlHours} hours
                </Attributes.Item>
                <Attributes.Item label="Build secrets">
                  {item.config.preview.secrets.build
                    ? "Configured"
                    : "Not configured"}
                </Attributes.Item>
                <Attributes.Item label="Deployment secrets">
                  {item.config.preview.secrets.deployment
                    ? "Configured"
                    : "Not configured"}
                </Attributes.Item>
                <Attributes.Item label="Pre-deploy hook secrets">
                  {item.config.preview.secrets.hooks?.preDeploy
                    ? "Configured"
                    : "Not configured"}
                </Attributes.Item>
                <Attributes.Item label="Post-deploy hook secrets">
                  {item.config.preview.secrets.hooks?.postDeploy
                    ? "Configured"
                    : "Not configured"}
                </Attributes.Item>
              </Attributes>
            ),
          },
        ]
      : []),
  ];

  return (
    <Tabs
      className="block"
      defaultSelectedKey="build"
      orientation={orientation}
    >
      <div className="grid gap-4 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <Tabs.ListContainer className="h-fit w-full self-start">
          <Tabs.List aria-label="App configuration" className="w-full">
            {tabs.map((tab) => (
              <Tabs.Tab
                className={
                  orientation === "vertical" ? "justify-start" : undefined
                }
                id={tab.value}
                key={tab.value}
              >
                <span className="relative z-10">{tab.label}</span>
                <Tabs.Indicator />
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs.ListContainer>
        <div className="min-w-0">
          {tabs.map((tab) => (
            <Tabs.Panel
              className="m-0 block p-0"
              id={tab.value}
              key={tab.value}
            >
              {tab.content}
            </Tabs.Panel>
          ))}
        </div>
      </div>
    </Tabs>
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

function formatCount(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
