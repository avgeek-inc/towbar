"use client";

import {
  DashboardCircleIcon,
  DatabaseIcon,
  GithubIcon,
  InformationSquareIcon,
  ServerStack01Icon,
  Settings01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useParams, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import type {
  App,
  AwsCredentialMetadata,
  Resource,
  SourceServer,
  Source,
  SourceSync,
} from "@workspace/towbar-web-client";
import { Chip } from "@workspace/web-design-system/data-display/chip";
import { EmptyState } from "@workspace/web-design-system/data-display/empty-state";
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
import { api } from "@/lib/api";
import { formatDate } from "./dashboard-overview";
import { SourceAwsCredentials } from "./source-aws-credentials";
import { SourceApps, SourceResources, SourceServers } from "./source-inventory";

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
  );
  const resources = useApiQuery<{ resources: Resource[] }>(
    `/v1/core/sources/${sourceId}/resources`,
  );
  const servers = useApiQuery<{ servers: SourceServer[] }>(
    `/v1/core/sources/${sourceId}/servers`,
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
                  "Towbar will fetch the latest commit from the configured branch, validate the manifest, and reconcile this Source. Changed deployables with auto-deploy enabled may be queued.",
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
                error={apps.error}
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
                error={resources.error}
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
                error={servers.error ?? apps.error ?? resources.error}
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
                      <EmptyState className="min-h-64 justify-center">
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
              <SourceSubtabs
                ariaLabel="Source settings"
                defaultSelectedKey="aws"
                tabs={[
                  {
                    value: "aws",
                    label: "AWS credentials",
                    content: (
                      <SourceAwsCredentials
                        canManage={source.data.canManageSource}
                        query={aws}
                        sourceId={sourceId}
                      />
                    ),
                  },
                  ...(source.data.canManageSource
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
                                    title:
                                      "Delete this Source and all of its data?",
                                  }}
                                  onSuccess={() => router.push("/sources")}
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
            ),
          },
        ]}
      />
    </DashboardPage>
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
  tabs,
}: {
  ariaLabel: string;
  defaultSelectedKey: string;
  tabs: Array<{ content: ReactNode; label: string; value: string }>;
}) {
  return (
    <Tabs
      className="block"
      defaultSelectedKey={defaultSelectedKey}
      orientation="vertical"
    >
      <div className="grid gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <Tabs.ListContainer className="w-full">
          <Tabs.List aria-label={ariaLabel} className="w-full">
            {tabs.map((tab) => (
              <Tabs.Tab
                className="justify-start"
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
