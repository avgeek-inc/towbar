"use client";

import {
  DashboardCircleIcon,
  DatabaseIcon,
  GithubIcon,
  InformationSquareIcon,
  Settings01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { type Key, type ReactNode } from "react";
import type {
  App,
  Deployment,
  Resource,
  RuntimeCapacity,
  Server,
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
  FormCard,
  InlineLink,
  PageTabs,
  sourcesBreadcrumb,
} from "@/components/page-parts";
import { useApiQuery } from "@/hooks/use-api-query";
import { api } from "@/lib/api";
import { formatDate } from "./dashboard-overview";
import { SourceSecrets } from "./app-secrets";
import {
  SourceNotifications,
  type NotificationDestinationsResponse,
} from "./source-notifications";
import { SourceApps, SourceResources } from "./source-inventory";
import { ResponsiveSubtabs } from "./responsive-subtabs";
import { AutoDeployControlEditor } from "./auto-deploy-control";

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
  const deployments = useApiQuery<{ deployments: Deployment[] }>(
    `/v1/core/sources/${sourceId}/deployments`,
    5_000,
  );
  const capacity = useApiQuery<{ capacities: RuntimeCapacity[] }>(
    `/v1/core/sources/${sourceId}/capacity`,
    5_000,
  );
  const servers = useApiQuery<{ servers: Server[] }>("/v1/core/servers", 5_000);
  const error = source.error ?? manifest.error ?? syncs.error;
  if (error)
    return (
      <DashboardPage
        icon={GithubIcon}
        breadcrumbAncestors={sourcesBreadcrumb}
        title="Source"
      >
        <QueryError message={error} />
      </DashboardPage>
    );
  if (!source.data || !manifest.data || !syncs.data)
    return (
      <DashboardPage
        icon={GithubIcon}
        breadcrumbAncestors={sourcesBreadcrumb}
        title="Source"
      >
        <QueryLoading />
      </DashboardPage>
    );

  const item = source.data.source;
  const latestSync = syncs.data.syncs[0];
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
      icon={GithubIcon}
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
                error={
                  apps.error ??
                  capacity.error ??
                  deployments.error ??
                  servers.error
                }
                servers={servers.data?.servers}
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
                error={
                  resources.error ??
                  capacity.error ??
                  deployments.error ??
                  servers.error
                }
                resources={resources.data?.resources}
                servers={servers.data?.servers}
                sourceId={sourceId}
              />
            ),
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
                canManage={source.data.canManageSource}
                isActive={searchParams.get("section") === "settings"}
                onDelete={() => router.push("/sources")}
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
  canManage,
  isActive,
  onDelete,
  sourceId,
}: {
  canManage: boolean;
  isActive: boolean;
  onDelete: () => void;
  sourceId: string;
}) {
  const notificationDestinations =
    useApiQuery<NotificationDestinationsResponse>(
      isActive
        ? `/v1/core/sources/${sourceId}/notifications/destinations`
        : null,
    );

  return (
    <SourceSubtabs
      ariaLabel="Source settings"
      collapseOnMobile
      defaultSelectedKey="secrets"
      tabs={[
        {
          value: "auto-deploy",
          label: "Auto-deploy",
          content: <AutoDeployControlEditor id={sourceId} type="source" />,
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
          label: "Shared secrets",
          content: <SourceSecrets active={isActive} sourceId={sourceId} />,
        },
        ...(canManage
          ? [
              {
                value: "danger",
                label: "Danger zone",
                content: (
                  <FormCard title="Danger zone">
                    <div className="grid gap-5">
                      <p className="max-w-3xl text-sm text-muted">
                        Deleting a Source removes its imported inventory and
                        operational history. Workspace integrations, servers,
                        and backup objects already in S3 remain available.
                      </p>
                      <ActionButton
                        action={() =>
                          api.delete(`/v1/core/sources/${sourceId}`)
                        }
                        confirm={{
                          actionLabel: "Delete Source permanently",
                          description:
                            "This permanently deletes the Source, sync history, Apps, Resources, Deployments, Releases, backup metadata, and runtime operations. Workspace integrations, servers, their credentials, checks, and trust records remain available. This cannot be undone.",
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
                  </FormCard>
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
