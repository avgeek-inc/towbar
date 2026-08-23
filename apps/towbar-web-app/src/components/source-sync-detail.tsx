"use client";

import {
  DashboardCircleIcon,
  DatabaseIcon,
  GitCompareIcon,
  InformationSquareIcon,
  RefreshIcon,
  ServerStack01Icon,
  ValidationIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useParams } from "next/navigation";
import type { SourceSync } from "@workspace/towbar-web-client";
import { Attributes } from "@workspace/web-design-system/data-display/attributes";
import { Chip } from "@workspace/web-design-system/data-display/chip";
import { EmptyState } from "@workspace/web-design-system/data-display/empty-state";
import { Alert } from "@workspace/web-design-system/feedback/alert";
import { TypographyCode } from "@workspace/web-design-system/typography/typography";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import {
  ResourceTable,
  type ResourceTableColumn,
} from "@workspace/towbar-web-ui/resource-table";
import { StatusBadge } from "@workspace/towbar-web-ui/status-badge";

import { DashboardPage, PageTabs } from "@/components/page-parts";
import { formatDate } from "@/components/dashboard-overview";
import { useApiQuery } from "@/hooks/use-api-query";
import { useSourceBreadcrumbs } from "./source-breadcrumbs";

export function SourceSyncDetail() {
  const { sourceId, syncId } = useParams<{
    sourceId: string;
    syncId: string;
  }>();
  const query = useApiQuery<{ sync: SourceSync }>(
    `/v1/core/sources/${sourceId}/syncs/${syncId}`,
    5_000,
  );
  const breadcrumbAncestors = useSourceBreadcrumbs(sourceId, {
    href: `/sources/${sourceId}?section=info`,
    label: "Info",
  });

  if (query.error) {
    return (
      <DashboardPage
        breadcrumbAncestors={breadcrumbAncestors}
        title="Source sync"
      >
        <QueryError message={query.error} />
      </DashboardPage>
    );
  }

  if (!query.data) {
    return (
      <DashboardPage
        breadcrumbAncestors={breadcrumbAncestors}
        title="Source sync"
      >
        <QueryLoading />
      </DashboardPage>
    );
  }

  const sync = query.data.sync;
  const issueCount = Array.isArray(sync.issues) ? sync.issues.length : 0;
  const changes = readReconciliationChanges(sync.reconciliation);
  return (
    <DashboardPage
      badge={<StatusBadge status={sync.status} />}
      breadcrumbAncestors={breadcrumbAncestors}
      title={`Sync ${sync.id.slice(0, 8)}`}
      titleContent={
        <span className="inline-flex min-w-0 items-center gap-3">
          <HugeiconsIcon
            aria-hidden="true"
            className="size-8 shrink-0"
            icon={RefreshIcon}
          />
          <span>Sync</span>
          <TypographyCode title={sync.id}>{sync.id.slice(0, 8)}</TypographyCode>
        </span>
      }
    >
      <PageTabs
        defaultValue={
          sync.status === "failed" && issueCount ? "issues" : "overview"
        }
        tabs={[
          {
            value: "overview",
            label: "Overview",
            icon: <HugeiconsIcon icon={InformationSquareIcon} />,
            content: (
              <div className="grid gap-8 lg:grid-cols-2">
                <Attributes columns={2} title="Sync" variant="card">
                  <Attributes.Item label="Requested">
                    {formatDate(sync.createdAt)}
                  </Attributes.Item>
                  <Attributes.Item label="Started">
                    {sync.startedAt
                      ? formatDate(sync.startedAt)
                      : "Not started"}
                  </Attributes.Item>
                  <Attributes.Item label="Finished">
                    {sync.finishedAt
                      ? formatDate(sync.finishedAt)
                      : "Not finished"}
                  </Attributes.Item>
                  <Attributes.Item label="Duration">
                    {formatDuration(sync.startedAt, sync.finishedAt)}
                  </Attributes.Item>
                </Attributes>
                <Attributes columns={2} title="Revision" variant="card">
                  <Attributes.Item label="Commit">
                    {sync.commitSha ? (
                      <TypographyCode title={sync.commitSha}>
                        {sync.commitSha.slice(0, 12)}
                      </TypographyCode>
                    ) : (
                      "Not recorded"
                    )}
                  </Attributes.Item>
                  <Attributes.Item label="Manifest digest">
                    {sync.manifestDigest ? (
                      <TypographyCode title={sync.manifestDigest}>
                        {sync.manifestDigest.slice(0, 12)}
                      </TypographyCode>
                    ) : (
                      "Not recorded"
                    )}
                  </Attributes.Item>
                  <Attributes.Item label="Sync ID">
                    <TypographyCode title={sync.id}>
                      {sync.id.slice(0, 8)}
                    </TypographyCode>
                  </Attributes.Item>
                </Attributes>
              </div>
            ),
          },
          {
            value: "changes",
            label: "Changes",
            icon: <HugeiconsIcon icon={GitCompareIcon} />,
            indicator: changes.length
              ? { label: String(changes.length), variant: "secondary" }
              : undefined,
            content: (
              <SyncChanges changes={changes} value={sync.reconciliation} />
            ),
          },
          {
            value: "issues",
            label: "Validation issues",
            icon: <HugeiconsIcon icon={ValidationIcon} />,
            indicator: issueCount
              ? { label: String(issueCount), variant: "destructive" }
              : undefined,
            content: <SyncIssues value={sync.issues} />,
          },
        ]}
      />
    </DashboardPage>
  );
}

type ReconciliationAction = "archive" | "create" | "restore" | "update";
type ReconciliationKind = "App" | "Resource" | "Server";
type ReconciliationChange = {
  action: ReconciliationAction;
  id: string;
  kind: ReconciliationKind;
};

const changeColumns: ResourceTableColumn<ReconciliationChange>[] = [
  {
    key: "item",
    header: "Item",
    cell: (change) => (
      <TypographyCode className="whitespace-nowrap" title={change.id}>
        {change.id}
      </TypographyCode>
    ),
    className: "w-full min-w-64",
  },
  {
    key: "type",
    header: "Type",
    cell: (change) => (
      <span className="flex items-center gap-2 whitespace-nowrap">
        <HugeiconsIcon
          aria-hidden="true"
          className="size-5 shrink-0 text-muted"
          icon={reconciliationKindIcon(change.kind)}
        />
        {change.kind}
      </span>
    ),
    className: "min-w-40",
  },
  {
    key: "change",
    header: "Change",
    cell: (change) => <ChangeBadge action={change.action} />,
    className: "min-w-36",
  },
];

function SyncChanges({
  changes,
  value,
}: {
  changes: ReconciliationChange[];
  value: unknown;
}) {
  const legacyCounts = readLegacyReconciliationCounts(value);
  if (legacyCounts) {
    return (
      <Attributes columns={3} title="Imported inventory" variant="card">
        <Attributes.Item
          icon={<HugeiconsIcon icon={DashboardCircleIcon} />}
          label="Apps"
        >
          {legacyCounts.apps}
        </Attributes.Item>
        <Attributes.Item
          icon={<HugeiconsIcon icon={DatabaseIcon} />}
          label="Resources"
        >
          {legacyCounts.resources}
        </Attributes.Item>
        <Attributes.Item
          icon={<HugeiconsIcon icon={ServerStack01Icon} />}
          label="Servers"
        >
          {legacyCounts.servers}
        </Attributes.Item>
      </Attributes>
    );
  }
  return (
    <ResourceTable
      ariaLabel="Source sync changes"
      columns={changeColumns}
      emptyDescription="The manifest matched the current apps, resources, and servers."
      emptyTitle="No inventory changes"
      getRowKey={(change) => `${change.kind}:${change.id}:${change.action}`}
      items={changes}
      tableClassName="min-w-[640px]"
    />
  );
}

function ChangeBadge({ action }: { action: ReconciliationAction }) {
  const variant =
    action === "archive"
      ? "destructive"
      : action === "update"
        ? "warning"
        : "success";
  return <Chip variant={variant}>{formatChangeAction(action)}</Chip>;
}

function SyncIssues({ value }: { value: unknown }) {
  if (!Array.isArray(value) || value.length === 0) {
    return (
      <EmptyState className="min-h-64 justify-center">
        <EmptyState.Header>
          <EmptyState.Title>No validation issues</EmptyState.Title>
          <EmptyState.Description>
            This manifest passed validation without any recorded issues.
          </EmptyState.Description>
        </EmptyState.Header>
      </EmptyState>
    );
  }
  return (
    <div className="grid gap-3">
      {value.map((issue, index) => (
        <Alert status="danger" key={`${readIssuePath(issue)}:${index}`}>
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>
              <TypographyCode>{readIssuePath(issue)}</TypographyCode>
            </Alert.Title>
            <Alert.Description>{readIssueMessage(issue)}</Alert.Description>
          </Alert.Content>
        </Alert>
      ))}
    </div>
  );
}

function readIssuePath(value: unknown) {
  if (value && typeof value === "object" && "path" in value) {
    const path = (value as { path?: unknown }).path;
    if (Array.isArray(path)) return path.join(".") || "Manifest";
    if (typeof path === "string") return path || "Manifest";
  }
  return "Manifest validation";
}

function readIssueMessage(value: unknown) {
  if (value && typeof value === "object" && "message" in value) {
    const message = (value as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return JSON.stringify(value);
}

function readReconciliationChanges(value: unknown) {
  if (!isRecord(value)) return [];
  return (
    [
      ["apps", "App"],
      ["resources", "Resource"],
      ["servers", "Server"],
    ] as const
  ).flatMap(([key, kind]) => {
    const entries = value[key];
    if (!Array.isArray(entries)) return [];
    return entries.flatMap((entry): ReconciliationChange[] => {
      if (!isRecord(entry)) return [];
      const action = entry.action;
      const id = entry.id;
      if (
        typeof id !== "string" ||
        !["archive", "create", "restore", "update"].includes(String(action))
      )
        return [];
      return [{ action: action as ReconciliationAction, id, kind }];
    });
  });
}

function readLegacyReconciliationCounts(value: unknown) {
  if (!isRecord(value)) return null;
  const { apps, resources, servers } = value;
  if (
    typeof apps !== "number" ||
    typeof resources !== "number" ||
    typeof servers !== "number"
  )
    return null;
  return { apps, resources, servers };
}

function reconciliationKindIcon(kind: ReconciliationKind) {
  if (kind === "App") return DashboardCircleIcon;
  if (kind === "Resource") return DatabaseIcon;
  return ServerStack01Icon;
}

function formatChangeAction(action: ReconciliationAction) {
  if (action === "archive") return "Archived";
  if (action === "create") return "Created";
  if (action === "restore") return "Restored";
  return "Updated";
}

function formatDuration(startedAt: string | null, finishedAt: string | null) {
  if (!startedAt) return "Not started";
  if (!finishedAt) return "In progress";
  const milliseconds = Math.max(
    0,
    new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
  );
  if (milliseconds < 1_000) return "Less than a second";
  const seconds = Math.round(milliseconds / 1_000);
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds
    ? `${minutes}m ${remainingSeconds}s`
    : `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
