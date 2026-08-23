"use client";

import {
  Activity01Icon,
  Delete02Icon,
  ServerStack01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";
import type {
  OrphanItem,
  ResourceOperation,
  Server,
  ServerCheck,
  TrustedHostKey,
} from "@workspace/towbar-web-client";
import { Attributes } from "@workspace/web-design-system/data-display/attributes";
import { Alert } from "@workspace/web-design-system/feedback/alert";
import { ItemCard } from "@workspace/web-design-system/data-display/item-card";
import { ItemCardGroup } from "@workspace/web-design-system/data-display/item-card-group";
import { TypographyCode } from "@workspace/web-design-system/typography/typography";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import {
  ResourceName,
  ResourceTable,
  type ResourceTableColumn,
} from "@workspace/towbar-web-ui/resource-table";
import { StatusBadge } from "@workspace/towbar-web-ui/status-badge";

import {
  ActionButton,
  DashboardPage,
  PageTabs,
  SectionBlock,
} from "@/components/page-parts";
import { useApiQuery } from "@/hooks/use-api-query";
import { api } from "@/lib/api";
import { formatDate } from "./dashboard-overview";
import { useSourceBreadcrumbs } from "./source-breadcrumbs";

type DiscoveredKey = {
  algorithm: string;
  fingerprint: string;
  publicKey: string;
};

export function ServerDetail() {
  const { serverId, sourceId } = useParams<{
    serverId: string;
    sourceId?: string;
  }>();
  const router = useRouter();
  const server = useApiQuery<{
    canCleanupOrphans: boolean;
    server: Server;
  }>(`/v1/core/servers/${serverId}`);
  const resolvedSourceId = sourceId ?? server.data?.server.sourceId;
  const breadcrumbAncestors = useSourceBreadcrumbs(
    resolvedSourceId,
    resolvedSourceId
      ? {
          href: `/sources/${resolvedSourceId}?section=servers`,
          label: "Servers",
        }
      : undefined,
  );
  const checks = useApiQuery<{ checks: ServerCheck[] }>(
    `/v1/core/servers/${serverId}/checks`,
    5_000,
  );
  const keys = useApiQuery<{ hostKeys: TrustedHostKey[] }>(
    `/v1/core/servers/${serverId}/host-keys`,
  );
  const orphans = useApiQuery<{ orphans: OrphanItem[] }>(
    `/v1/core/servers/${serverId}/orphans`,
    5_000,
  );
  useEffect(() => {
    if (!sourceId && server.data) {
      router.replace(
        `/sources/${server.data.server.sourceId}/servers/${serverId}`,
      );
    }
  }, [router, server.data, serverId, sourceId]);
  const error = server.error ?? checks.error ?? keys.error ?? orphans.error;
  if (error)
    return (
      <DashboardPage breadcrumbAncestors={breadcrumbAncestors} title="Server">
        <QueryError message={error} />
      </DashboardPage>
    );
  if (!server.data || !checks.data || !keys.data || !orphans.data)
    return (
      <DashboardPage breadcrumbAncestors={breadcrumbAncestors} title="Server">
        <QueryLoading />
      </DashboardPage>
    );

  const item = server.data.server;
  if (!sourceId)
    return (
      <DashboardPage breadcrumbAncestors={breadcrumbAncestors} title="Server">
        <QueryLoading />
      </DashboardPage>
    );
  const orphanItems = orphans.data.orphans;
  const orphanVolumes = orphanItems.filter((item) => item.kind === "volume");
  const disposableOrphans = orphanItems.filter(
    (item) => item.kind !== "volume",
  );
  if (sourceId && item.sourceId !== sourceId) {
    return (
      <DashboardPage breadcrumbAncestors={breadcrumbAncestors} title="Server">
        <QueryError
          message="This Server does not belong to the selected Source."
          retryable={false}
        />
      </DashboardPage>
    );
  }
  const discovered = readDiscoveredKeys(checks.data.checks);
  const latestCheck = checks.data.checks[0];
  const operatingSystem = readCheckResult(latestCheck, "operatingSystem");
  const dockerVersion = readCheckResult(latestCheck, "dockerVersion");
  const checkColumns: ResourceTableColumn<ServerCheck>[] = [
    {
      key: "check",
      header: "Check ID",
      cell: (check) => (
        <TypographyCode title={check.id}>{check.id.slice(0, 8)}</TypographyCode>
      ),
      className: "min-w-36",
    },
    {
      key: "result",
      header: "Result",
      cell: (check) =>
        check.errorMessage ?? (
          <span className="whitespace-nowrap">
            {summarizeCheck(check.result)}
          </span>
        ),
      className: "w-full min-w-72",
    },
    {
      key: "finished",
      header: "Finished",
      cell: (check) =>
        check.finishedAt ? formatDate(check.finishedAt) : "In progress",
      className: "whitespace-nowrap",
    },
    {
      key: "status",
      header: "Status",
      cell: (check) => <StatusBadge status={check.status} />,
    },
  ];
  const orphanColumns: ResourceTableColumn<OrphanItem>[] = [
    {
      key: "object",
      header: "Docker object",
      cell: (orphan) => (
        <ResourceName description={orphan.reason} name={orphan.name} />
      ),
      className: "w-full min-w-72",
    },
    {
      key: "type",
      header: "Type",
      cell: (orphan) => <span className="capitalize">{orphan.kind}</span>,
    },
  ];

  return (
    <DashboardPage
      actions={
        <ActionButton
          action={() =>
            api.post(`/v1/core/servers/${serverId}/actions/check`, {
              sourceId: item.sourceId,
            })
          }
          pendingLabel="Checking…"
          success="Server check queued"
          variant="primary"
        >
          Check server
        </ActionButton>
      }
      badge={<StatusBadge status={item.archivedAt ? "archived" : "active"} />}
      breadcrumbAncestors={breadcrumbAncestors}
      title={item.canonicalIp}
      titleContent={
        <span className="inline-flex min-w-0 items-center gap-3">
          <HugeiconsIcon
            aria-hidden="true"
            className="size-8 shrink-0"
            icon={ServerStack01Icon}
          />
          <span className="truncate" title={item.canonicalIp}>
            {item.canonicalIp}
          </span>
        </span>
      }
    >
      <div className="grid gap-6">
        {discovered.length ? (
          <Alert status="warning">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>Untrusted SSH host key</Alert.Title>
              <Alert.Description>
                Towbar stopped before login. Verify the discovered fingerprint
                independently before trusting this server.
              </Alert.Description>
            </Alert.Content>
          </Alert>
        ) : null}
        <PageTabs
          defaultValue="overview"
          tabs={[
            {
              value: "overview",
              label: "Overview",
              icon: <HugeiconsIcon icon={ServerStack01Icon} />,
              content: (
                <div className="grid gap-8 lg:grid-cols-2">
                  <Attributes columns={2} title="Connection" variant="card">
                    <Attributes.Item label="IP address">
                      {item.canonicalIp}
                    </Attributes.Item>
                    <Attributes.Item label="SSH host">
                      {item.config.ssh.host ?? item.canonicalIp}
                    </Attributes.Item>
                    <Attributes.Item label="SSH user">
                      {item.config.ssh.username}
                    </Attributes.Item>
                    <Attributes.Item label="SSH port">
                      {item.config.ssh.port}
                    </Attributes.Item>
                    <Attributes.Item label="Source revision">
                      <TypographyCode title={item.sourceRevision}>
                        {item.sourceRevision.slice(0, 12)}
                      </TypographyCode>
                    </Attributes.Item>
                    <Attributes.Item label="Last synced">
                      {formatDate(item.updatedAt)}
                    </Attributes.Item>
                  </Attributes>
                  <Attributes columns={2} title="Operations" variant="card">
                    <Attributes.Item label="Latest check">
                      {latestCheck ? (
                        <StatusBadge status={latestCheck.status} />
                      ) : (
                        "Not checked"
                      )}
                    </Attributes.Item>
                    <Attributes.Item label="Last checked">
                      {latestCheck?.finishedAt
                        ? formatDate(latestCheck.finishedAt)
                        : "Not checked"}
                    </Attributes.Item>
                    <Attributes.Item label="Operating system">
                      {operatingSystem ?? "Unknown"}
                    </Attributes.Item>
                    <Attributes.Item label="Docker">
                      {dockerVersion ?? "Unknown"}
                    </Attributes.Item>
                    <Attributes.Item label="Concurrent builds">
                      {item.config.buildConcurrency ?? 1}
                    </Attributes.Item>
                    <Attributes.Item label="Trusted host keys">
                      {keys.data.hostKeys.length}
                    </Attributes.Item>
                  </Attributes>
                  {discovered.length ? (
                    <div className="lg:col-span-2">
                      <SectionBlock
                        description="Compare each fingerprint against the server console or cloud provider."
                        title="Trust first connection"
                      >
                        <ItemCardGroup variant="secondary">
                          {discovered.map((key) => (
                            <ItemCard key={key.fingerprint} variant="outline">
                              <ItemCard.Content>
                                <ItemCard.Title>{key.algorithm}</ItemCard.Title>
                                <ItemCard.Description>
                                  <TypographyCode className="break-all">
                                    {key.fingerprint}
                                  </TypographyCode>
                                </ItemCard.Description>
                              </ItemCard.Content>
                              <ItemCard.Action>
                                <ActionButton
                                  action={() =>
                                    api.post(
                                      `/v1/core/servers/${serverId}/host-keys/actions/trust`,
                                      key,
                                    )
                                  }
                                  confirm={{
                                    actionLabel: "Trust key",
                                    description:
                                      "Only continue if you verified this fingerprint through an independent channel.",
                                    title: (
                                      <span className="inline-flex flex-wrap items-center gap-1.5">
                                        <span>Trust</span>
                                        <TypographyCode className="break-all">
                                          {key.fingerprint}
                                        </TypographyCode>
                                        <span>?</span>
                                      </span>
                                    ),
                                  }}
                                  success="Host key trusted"
                                >
                                  Trust key
                                </ActionButton>
                              </ItemCard.Action>
                            </ItemCard>
                          ))}
                        </ItemCardGroup>
                      </SectionBlock>
                    </div>
                  ) : null}
                </div>
              ),
            },
            {
              value: "checks",
              label: "Checks",
              icon: <HugeiconsIcon icon={Activity01Icon} />,
              indicator: {
                label: String(checks.data.checks.length),
                variant: "secondary",
              },
              content: (
                <ResourceTable
                  ariaLabel={`${item.canonicalIp} checks`}
                  columns={checkColumns}
                  emptyDescription="Run a server check to validate SSH, Docker, and the host environment."
                  emptyTitle="No checks yet"
                  getRowKey={(check) => check.id}
                  items={checks.data.checks}
                  tableClassName="min-w-[900px]"
                />
              ),
            },
            {
              value: "cleanup",
              label: "Cleanup",
              icon: <HugeiconsIcon icon={Delete02Icon} />,
              indicator: orphanItems.length
                ? { label: String(orphanItems.length), variant: "warning" }
                : undefined,
              content: (
                <div className="grid gap-8">
                  {orphanItems.length ? (
                    <Alert status="warning">
                      <Alert.Indicator />
                      <Alert.Content>
                        <Alert.Title>
                          Cleanup is explicit and source-scoped
                        </Alert.Title>
                        <Alert.Description>
                          Towbar revalidates every selected object against the
                          latest releases and Source ownership labels
                          immediately before removal. Volumes may contain
                          permanent data and are never removed automatically.
                        </Alert.Description>
                      </Alert.Content>
                    </Alert>
                  ) : null}
                  {server.data.canCleanupOrphans && orphanItems.length ? (
                    <div className="flex flex-wrap gap-2">
                      {disposableOrphans.length ? (
                        <CleanupButton
                          description={`Towbar will re-check and remove ${disposableOrphans.length} Source-owned containers or images. Objects no longer orphaned will be skipped.`}
                          items={disposableOrphans}
                          label="Clean containers and images"
                          serverId={serverId}
                          title="Clean up these containers and images?"
                        />
                      ) : null}
                      {orphanVolumes.length ? (
                        <CleanupButton
                          description={`This permanently deletes ${orphanVolumes.length} Source-owned Docker volumes and all data still stored in them. Towbar will re-check each volume and skip anything currently owned by a deployable.`}
                          items={orphanVolumes}
                          label="Delete orphan volumes"
                          serverId={serverId}
                          title="Permanently delete these orphan volumes?"
                        />
                      ) : null}
                    </div>
                  ) : null}
                  <ResourceTable
                    ariaLabel={`Orphaned Docker objects on ${item.canonicalIp}`}
                    columns={orphanColumns}
                    emptyDescription="The latest successful server check found no Source-owned objects safe to classify as orphaned."
                    emptyTitle="No scoped orphans"
                    getRowKey={(orphan) => `${orphan.kind}:${orphan.name}`}
                    items={orphanItems}
                  />
                </div>
              ),
            },
          ]}
        />
      </div>
    </DashboardPage>
  );
}

function CleanupButton({
  description,
  items,
  label,
  serverId,
  title,
}: {
  description: string;
  items: OrphanItem[];
  label: string;
  serverId: string;
  title: string;
}) {
  return (
    <ActionButton<{ operation: ResourceOperation }>
      action={() =>
        api.post<{ operation: ResourceOperation }>(
          `/v1/core/servers/${serverId}/actions/cleanup-orphans`,
          { items: items.map(({ kind, name }) => ({ kind, name })) },
          { "Idempotency-Key": crypto.randomUUID() },
        )
      }
      confirm={{ actionLabel: label, description, title }}
      success="Orphan cleanup queued"
      variant="danger"
    >
      {label}
    </ActionButton>
  );
}

function readDiscoveredKeys(checks: ServerCheck[]): DiscoveredKey[] {
  const failed = checks.find(
    (check) => check.errorCode === "HOST_KEY_NOT_TRUSTED",
  );
  const value = failed?.result?.discoveredHostKeys;
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is DiscoveredKey =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as DiscoveredKey).algorithm === "string" &&
      typeof (item as DiscoveredKey).fingerprint === "string" &&
      typeof (item as DiscoveredKey).publicKey === "string",
  );
}

function summarizeCheck(result: Record<string, unknown> | null) {
  if (!result) return "Waiting for the worker";
  const os =
    typeof result.operatingSystem === "string"
      ? result.operatingSystem
      : "Server reachable";
  const docker =
    typeof result.dockerVersion === "string"
      ? ` · Docker ${result.dockerVersion}`
      : "";
  return `${os}${docker}`;
}

function readCheckResult(
  check: ServerCheck | undefined,
  key: "dockerVersion" | "operatingSystem",
) {
  const value = check?.result?.[key];
  return typeof value === "string" ? value : null;
}
