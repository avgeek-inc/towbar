"use client";

import {
  DashboardCircleIcon,
  DatabaseIcon,
  GithubIcon,
  GitBranchIcon,
  InformationSquareIcon,
  Key01Icon,
  ServerStack01Icon,
  Settings01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useParams, useRouter } from "next/navigation";
import { type Key, type ReactNode } from "react";
import type {
  App,
  AwsCredentialMetadata,
  Deployment,
  Resource,
  SourceServer,
  Source,
  SourceSync,
} from "@workspace/towbar-web-client";
import { Chip } from "@workspace/web-design-system/data-display/chip";
import { EmptyState } from "@workspace/web-design-system/data-display/empty-state";
import { Alert } from "@workspace/web-design-system/feedback/alert";
import { useTablePagination } from "@workspace/web-design-system/hooks/use-table-pagination";
import { Pagination } from "@workspace/web-design-system/navigation/pagination";
import { Tabs } from "@workspace/web-design-system/navigation/tabs";
import { TypographyCode } from "@workspace/web-design-system/typography/typography";
import { CodePanel } from "@workspace/towbar-web-ui/code-panel";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import {
  ResourceTable,
  type ResourceTableColumn,
} from "@workspace/towbar-web-ui/resource-table";
import { StatusBadge } from "@workspace/towbar-web-ui/status-badge";

import {
  ActionButton,
  DashboardPage,
  InlineLink,
  PageTabs,
  SectionBlock,
  sourcesBreadcrumb,
} from "@/components/page-parts";
import { useApiQuery } from "@/hooks/use-api-query";
import { useResponsiveTabsOrientation } from "@/hooks/use-responsive-tabs-orientation";
import { api } from "@/lib/api";
import { formatDate } from "./dashboard-overview";
import { SourceAwsCredentials } from "./source-aws-credentials";
import { SourceSecrets } from "./app-secrets";
import { SourceApps, SourceResources, SourceServers } from "./source-inventory";
import { PreviewEnvironments } from "./preview-environments";

type ManifestResponse = {
  manifest: {
    commitSha: string;
    manifest: unknown;
    manifestDigest: string;
    rawManifest: string;
  } | null;
};

const SOURCE_SYNC_PAGE_SIZE = 10;

export function SourceDetail() {
  const { sourceId } = useParams<{ sourceId: string }>();
  const router = useRouter();
  const source = useApiQuery<{
    canManageSource: boolean;
    source: Source;
  }>(`/v1/core/sources/${sourceId}`);
  const manifest = useApiQuery<ManifestResponse>(
    `/v1/core/sources/${sourceId}/manifest`,
  );
  const syncs = useApiQuery<{ syncs: SourceSync[] }>(
    `/v1/core/sources/${sourceId}/syncs`,
    5_000,
  );
  const apps = useApiQuery<{ apps: App[] }>(
    `/v1/core/sources/${sourceId}/apps`,
    5_000,
  );
  const resources = useApiQuery<{ resources: Resource[] }>(
    `/v1/core/sources/${sourceId}/resources`,
    5_000,
  );
  const servers = useApiQuery<{ servers: SourceServer[] }>(
    `/v1/core/sources/${sourceId}/servers`,
    5_000,
  );
  const deployments = useApiQuery<{ deployments: Deployment[] }>(
    `/v1/core/sources/${sourceId}/deployments`,
    5_000,
  );
  const aws = useApiQuery<{ credential: AwsCredentialMetadata | null }>(
    `/v1/core/sources/${sourceId}/aws`,
  );
  const error = source.error ?? manifest.error ?? syncs.error;
  if (error)
    return (
      <DashboardPage breadcrumbAncestors={sourcesBreadcrumb} title="Source">
        <QueryError message={error} />
      </DashboardPage>
    );
  if (!source.data || !manifest.data || !syncs.data)
    return (
      <DashboardPage breadcrumbAncestors={sourcesBreadcrumb} title="Source">
        <QueryLoading />
      </DashboardPage>
    );

  const item = source.data.source;
  const latestSync = syncs.data.syncs[0];
  const untrustedServers =
    servers.data?.servers.filter(
      (server) => server.hostKeyStatus === "untrusted",
    ) ?? [];
  const syncColumns: ResourceTableColumn<SourceSync>[] = [
    {
      key: "commit",
      header: "Commit",
      cell: (sync) => (
        <TypographyCode
          className="whitespace-nowrap"
          title={sync.commitSha ?? undefined}
        >
          {sync.commitSha?.slice(0, 12) ??
            (sync.status === "queued" || sync.status === "running"
              ? "Resolving revision"
              : "Revision not recorded")}
        </TypographyCode>
      ),
      className: "w-full min-w-44",
    },
    {
      key: "result",
      header: "Result",
      cell: (sync) => getSyncIssueMessage(sync.issues) ?? "Manifest accepted",
      className: "min-w-48 whitespace-nowrap",
    },
    {
      key: "requested",
      header: "Requested",
      cell: (sync) => formatDate(sync.createdAt),
      className: "whitespace-nowrap",
    },
    {
      key: "status",
      header: "Status",
      cell: (sync) => <StatusBadge status={sync.status} />,
    },
  ];

  return (
    <DashboardPage
      actions={
        <div className="flex flex-wrap justify-end gap-2">
          {item.status === "active" ? (
            <ActionButton
              action={() =>
                api.post(`/v1/core/sources/${sourceId}/actions/sync`)
              }
              confirm={{
                actionLabel: "Sync source",
                description:
                  "Towbar will fetch the latest commit, validate and reconcile the manifest, then queue every eligible missing or outdated deployable with auto-deploy enabled.",
                title: "Sync this Source now?",
              }}
              pendingLabel="Queueing sync…"
              success="Source sync queued"
              variant="primary"
            >
              Sync now
            </ActionButton>
          ) : null}
        </div>
      }
      breadcrumbAncestors={sourcesBreadcrumb}
      badge={
        latestSync ? (
          <InlineLink
            className="inline-flex items-center"
            href={`/sources/${sourceId}/syncs/${latestSync.id}`}
          >
            <SyncStatusChip sync={latestSync} />
          </InlineLink>
        ) : (
          <SyncStatusChip />
        )
      }
      title={item.repositoryName}
      titleContent={
        <span className="inline-flex min-w-0 items-center gap-3">
          <HugeiconsIcon
            aria-hidden="true"
            className="size-8 shrink-0"
            icon={GithubIcon}
          />
          <span className="truncate" title={item.repositoryName}>
            {item.repositoryName}
          </span>
        </span>
      }
    >
      {untrustedServers.length ? (
        <Alert status="warning">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>
              {untrustedServers.length === 1
                ? "A server has untrusted host keys"
                : `${untrustedServers.length} servers have untrusted host keys`}
            </Alert.Title>
            <Alert.Description>
              Towbar stops before login on affected servers. Run a server check,
              verify each fingerprint independently, then trust matching keys
              from each server&apos;s Host Keys tab.
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}
      <PageTabs
        defaultValue="apps"
        tabs={[
          {
            value: "apps",
            label: "Apps",
            icon: <HugeiconsIcon icon={DashboardCircleIcon} />,
            indicator: apps.data
              ? { label: String(apps.data.apps.length), variant: "secondary" }
              : undefined,
            content: (
              <SourceApps
                apps={apps.data?.apps}
                deployments={deployments.data?.deployments}
                error={apps.error ?? deployments.error}
                sourceId={sourceId}
              />
            ),
          },
          {
            value: "resources",
            label: "Resources",
            icon: <HugeiconsIcon icon={DatabaseIcon} />,
            indicator: resources.data
              ? {
                  label: String(resources.data.resources.length),
                  variant: "secondary",
                }
              : undefined,
            content: (
              <SourceResources
                deployments={deployments.data?.deployments}
                error={resources.error ?? deployments.error}
                resources={resources.data?.resources}
                sourceId={sourceId}
              />
            ),
          },
          {
            value: "servers",
            label: "Servers",
            icon: <HugeiconsIcon icon={ServerStack01Icon} />,
            indicator: servers.data
              ? {
                  label: String(servers.data.servers.length),
                  variant: "secondary",
                }
              : undefined,
            content: (
              <SourceServers
                apps={apps.data?.apps}
                deployments={deployments.data?.deployments}
                error={
                  servers.error ??
                  apps.error ??
                  resources.error ??
                  deployments.error
                }
                resources={resources.data?.resources}
                servers={servers.data?.servers}
                sourceId={sourceId}
              />
            ),
          },
          {
            value: "previews",
            label: "Previews",
            icon: <HugeiconsIcon icon={GitBranchIcon} />,
            content: <PreviewEnvironments sourceId={sourceId} />,
          },
          {
            value: "secrets",
            label: "Secrets",
            icon: <HugeiconsIcon icon={Key01Icon} />,
            content: <SourceSecrets sourceId={sourceId} />,
          },
          {
            value: "info",
            label: "Info",
            icon: <HugeiconsIcon icon={InformationSquareIcon} />,
            content: (
              <SourceSubtabs
                ariaLabel="Source information"
                defaultSelectedKey="manifest"
                tabs={[
                  {
                    value: "manifest",
                    label: "Manifest",
                    content: manifest.data.manifest ? (
                      <CodePanel
                        ariaLabel="Deployment manifest"
                        language="yaml"
                      >
                        {manifest.data.manifest.rawManifest}
                      </CodePanel>
                    ) : (
                      <EmptyState>
                        <EmptyState.Header>
                          <EmptyState.Title>
                            No manifest imported
                          </EmptyState.Title>
                          <EmptyState.Description>
                            Run the first Source sync to load and validate the
                            deployment manifest.
                          </EmptyState.Description>
                        </EmptyState.Header>
                      </EmptyState>
                    ),
                  },
                  {
                    value: "sync-history",
                    label: "Sync history",
                    content: (
                      <SourceSyncHistory
                        columns={syncColumns}
                        repositoryName={item.repositoryName}
                        sourceId={sourceId}
                        syncs={syncs.data.syncs}
                      />
                    ),
                  },
                ]}
              />
            ),
          },
          {
            value: "settings",
            label: "Settings",
            icon: <HugeiconsIcon icon={Settings01Icon} />,
            content: (
              <SourceSettings
                awsData={aws.data}
                awsError={aws.error}
                canManage={source.data.canManageSource}
                onDelete={() => router.push("/sources")}
                refreshAws={aws.refresh}
                sourceId={sourceId}
              />
            ),
          },
        ]}
      />
    </DashboardPage>
  );
}

function SourceSettings({
  awsData,
  awsError,
  canManage,
  onDelete,
  refreshAws,
  sourceId,
}: {
  awsData?: { credential: AwsCredentialMetadata | null };
  awsError?: string;
  canManage: boolean;
  onDelete: () => void;
  refreshAws: () => void;
  sourceId: string;
}) {
  return (
    <SourceSubtabs
      ariaLabel="Source settings"
      defaultSelectedKey="aws"
      tabs={[
        {
          value: "aws",
          label: "AWS credentials",
          content: (
            <SourceAwsCredentials
              canManage={canManage}
              query={{ data: awsData, error: awsError, refresh: refreshAws }}
              sourceId={sourceId}
            />
          ),
        },
        ...(canManage
          ? [
              {
                value: "danger",
                label: "Danger zone",
                content: (
                  <SectionBlock
                    description="Deleting a Source removes its credential, imported inventory, operational history, and source-owned server records. Backup objects already in S3 follow your bucket lifecycle."
                    title="Danger zone"
                  >
                    <div>
                      <ActionButton
                        action={() =>
                          api.delete(`/v1/core/sources/${sourceId}`)
                        }
                        confirm={{
                          actionLabel: "Delete Source permanently",
                          description:
                            "This permanently deletes the Source credential, sync history, Apps, Resources, Deployments, Releases, backup metadata, runtime operations, Servers, checks, and trust records. This cannot be undone.",
                          title: "Delete this Source and all of its data?",
                        }}
                        onSuccess={onDelete}
                        pendingLabel="Deleting…"
                        success="Source deleted"
                        variant="danger"
                      >
                        Delete Source
                      </ActionButton>
                    </div>
                  </SectionBlock>
                ),
              },
            ]
          : []),
      ]}
    />
  );
}

function SourceSyncHistory({
  columns,
  repositoryName,
  sourceId,
  syncs,
}: {
  columns: ResourceTableColumn<SourceSync>[];
  repositoryName: string;
  sourceId: string;
  syncs: SourceSync[];
}) {
  const pagination = useTablePagination({
    pageSize: SOURCE_SYNC_PAGE_SIZE,
    total: syncs.length,
  });
  const visibleSyncs = syncs.slice(
    pagination.offset,
    pagination.offset + pagination.pageSize,
  );

  return (
    <div className="grid gap-4">
      <ResourceTable
        ariaLabel={`${repositoryName} sync history`}
        columns={columns}
        emptyDescription="Run the first sync to validate and import the deployment manifest."
        emptyTitle="No sync attempts yet"
        getRowHref={(sync) => `/sources/${sourceId}/syncs/${sync.id}`}
        getRowKey={(sync) => sync.id}
        items={visibleSyncs}
      />
      {syncs.length > pagination.pageSize ? (
        <Pagination
          aria-label={`${repositoryName} sync history pages`}
          page={pagination.page}
          size="sm"
          totalPages={pagination.totalPages}
          onPageChange={pagination.setPage}
        />
      ) : null}
    </div>
  );
}

function SourceSubtabs({
  ariaLabel,
  defaultSelectedKey,
  onSelectionChange,
  selectedKey,
  tabs,
}: {
  ariaLabel: string;
  defaultSelectedKey: string;
  onSelectionChange?: (key: Key) => void;
  selectedKey?: string;
  tabs: Array<{ content: ReactNode; label: string; value: string }>;
}) {
  const orientation = useResponsiveTabsOrientation();

  return (
    <Tabs
      className="block"
      defaultSelectedKey={selectedKey ? undefined : defaultSelectedKey}
      orientation={orientation}
      selectedKey={selectedKey}
      onSelectionChange={onSelectionChange}
    >
      <div className="grid items-start gap-4 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <Tabs.ListContainer className="w-full">
          <Tabs.List aria-label={ariaLabel} className="w-full">
            {tabs.map((tab) => (
              <Tabs.Tab
                className={
                  orientation === "vertical" ? "justify-start" : undefined
                }
                id={tab.value}
                key={tab.value}
              >
                {tab.label}
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

function SyncStatusChip({ sync }: { sync?: SourceSync }) {
  const variant = !sync
    ? "secondary"
    : sync.status === "succeeded"
      ? "success"
      : sync.status === "failed"
        ? "destructive"
        : "warning";

  return <Chip variant={variant}>{getSyncStatusLabel(sync)}</Chip>;
}

function getSyncStatusLabel(sync?: SourceSync) {
  if (!sync) return "Not synced";
  if (sync.status === "queued") return "Sync queued";
  if (sync.status === "running") return "Syncing";
  if (sync.status === "succeeded") return "Synced";
  return "Sync failed";
}

function getSyncIssueMessage(issues: unknown[] | null) {
  const issue = issues?.[0];
  if (
    issue &&
    typeof issue === "object" &&
    "message" in issue &&
    typeof issue.message === "string"
  ) {
    return issue.message;
  }
  return undefined;
}
