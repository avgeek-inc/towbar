"use client";

import {
  DashboardCircleIcon,
  DatabaseIcon,
  GithubIcon,
  InformationSquareIcon,
  ServerStack01Icon,
  Settings01Icon,
  ValidationIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { type Key, type ReactNode } from "react";
import type {
  App,
  AppSecretsResponse,
  AwsCredentialMetadata,
  Deployment,
  Resource,
  RuntimeCapacity,
  SourceServer,
  Source,
  SourceSync,
} from "@workspace/towbar-web-client";
import { Chip } from "@workspace/web-design-system/data-display/chip";
import { EmptyState } from "@workspace/web-design-system/data-display/empty-state";
import { useTablePagination } from "@workspace/web-design-system/hooks/use-table-pagination";
import { Pagination } from "@workspace/web-design-system/navigation/pagination";
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
import { api } from "@/lib/api";
import { formatDate } from "./dashboard-overview";
import { SourceAwsCredentials } from "./source-aws-credentials";
import { SourceSecretStageEditor } from "./app-secrets";
import {
  SourceNotifications,
  type NotificationDestinationsResponse,
} from "./source-notifications";
import { SourceApps, SourceResources, SourceServers } from "./source-inventory";
import { SourcePlans } from "./source-plans";
import { ResponsiveSubtabs } from "./responsive-subtabs";

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
  const searchParams = useSearchParams();
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
  const capacity = useApiQuery<{ capacities: RuntimeCapacity[] }>(
    `/v1/core/sources/${sourceId}/capacity`,
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
        <span className="inline-flex min-w-0 items-center gap-2">
          <HugeiconsIcon
            aria-hidden="true"
            className="size-6 shrink-0"
            icon={GithubIcon}
          />
          <span className="truncate" title={item.repositoryName}>
            {item.repositoryName}
          </span>
        </span>
      }
    >
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
                capacities={capacity.data?.capacities}
                deployments={deployments.data?.deployments}
                error={apps.error ?? capacity.error ?? deployments.error}
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
                capacities={capacity.data?.capacities}
                deployments={deployments.data?.deployments}
                error={resources.error ?? capacity.error ?? deployments.error}
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
                  ariaLabel: untrustedServers.length
                    ? `${servers.data.servers.length} total; ${untrustedServers.length} ${untrustedServers.length === 1 ? "server has" : "servers have"} untrusted host keys`
                    : `${servers.data.servers.length} total`,
                  label: String(servers.data.servers.length),
                  variant: untrustedServers.length ? "warning" : "secondary",
                }
              : undefined,
            content: (
              <SourceServers
                capacities={capacity.data?.capacities}
                error={servers.error ?? capacity.error}
                servers={servers.data?.servers}
                sourceId={sourceId}
              />
            ),
          },
          {
            value: "plans",
            label: "Plans",
            icon: <HugeiconsIcon icon={ValidationIcon} />,
            content: <SourcePlans sourceId={sourceId} />,
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
                isActive={searchParams.get("section") === "settings"}
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
  isActive,
  onDelete,
  refreshAws,
  sourceId,
}: {
  awsData?: { credential: AwsCredentialMetadata | null };
  awsError?: string;
  canManage: boolean;
  isActive: boolean;
  onDelete: () => void;
  refreshAws: () => void;
  sourceId: string;
}) {
  const hasAwsCredentials = Boolean(awsData?.credential);
  const secrets = useApiQuery<AppSecretsResponse>(
    isActive && hasAwsCredentials
      ? `/v1/core/sources/${sourceId}/secrets`
      : null,
  );
  const notificationDestinations =
    useApiQuery<NotificationDestinationsResponse>(
      isActive
        ? `/v1/core/sources/${sourceId}/notifications/destinations`
        : null,
    );
  const secretsDisabledReason =
    "Add AWS credentials before editing shared secrets";

  return (
    <SourceSubtabs
      ariaLabel="Source settings"
      collapseOnMobile
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
        {
          value: "notifications",
          label: "Notifications",
          content: (
            <SourceNotifications
              canManage={canManage}
              destinations={notificationDestinations}
              sourceId={sourceId}
            />
          ),
        },
        {
          value: "secrets",
          label: "Secrets",
          isDisabled: !hasAwsCredentials,
          disabledReason: secretsDisabledReason,
          content: hasAwsCredentials ? (
            <SourceSecrets query={secrets} sourceId={sourceId} />
          ) : null,
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

function SourceSecrets({
  query,
  sourceId,
}: {
  query: {
    data?: AppSecretsResponse;
    error?: string;
    refresh: () => void;
  };
  sourceId: string;
}) {
  const stages = [
    { label: "Build", value: "build" },
    { label: "Deployment", value: "deployment" },
  ] as const;

  return (
    <ResponsiveSubtabs
      ariaLabel="Shared secret types"
      defaultSelectedKey="build"
      layout="inline"
      panelClassName="md:pt-6"
      tabs={stages.map(({ label, value: stage }) => ({
        label,
        value: stage,
        content: (
          <SourceSecretStageEditor
            query={query}
            sourceId={sourceId}
            stage={stage}
          />
        ),
      }))}
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
  collapseOnMobile = false,
  defaultSelectedKey,
  onSelectionChange,
  selectedKey,
  tabs,
}: {
  ariaLabel: string;
  collapseOnMobile?: boolean;
  defaultSelectedKey: string;
  onSelectionChange?: (key: Key) => void;
  selectedKey?: string;
  tabs: Array<{
    content: ReactNode;
    disabledReason?: string;
    isDisabled?: boolean;
    label: string;
    value: string;
  }>;
}) {
  return (
    <ResponsiveSubtabs
      ariaLabel={ariaLabel}
      collapseOnMobile={collapseOnMobile}
      defaultSelectedKey={defaultSelectedKey}
      selectedKey={selectedKey}
      sidebarWidth="wide"
      tabs={tabs}
      onSelectionChange={onSelectionChange}
    />
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
