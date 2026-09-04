"use client";

import { ConfigurationLinks } from "./configuration-links";

import { ServerCredentials } from "./credential-editor";

import {
  Activity01Icon,
  DashboardCircleIcon,
  Delete02Icon,
  Key01Icon,
  ServerStack01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useParams } from "next/navigation";
import { useEffect } from "react";
import type {
  OrphanItem,
  ResourceOperation,
  RuntimeCapacity,
  Server,
  ServerCheck,
  ServerChecksPage,
  ServerPreparation,
  TrustedHostKey,
} from "@workspace/towbar-web-client";
import { Attributes } from "@workspace/web-design-system/data-display/attributes";
import { Widget } from "@workspace/web-design-system/data-display/widget";
import { Alert } from "@workspace/web-design-system/feedback/alert";
import { useTablePagination } from "@workspace/web-design-system/hooks/use-table-pagination";
import { Pagination } from "@workspace/web-design-system/navigation/pagination";
import { Stepper } from "@workspace/web-design-system/navigation/stepper";
import { TypographyCode } from "@workspace/web-design-system/typography/typography";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import {
  ResourceName,
  ResourceTable,
  type ResourceTableColumn,
} from "@workspace/towbar-web-ui/resource-table";
import { StatusBadge } from "@workspace/towbar-web-ui/status-badge";

import { ActionButton, DashboardPage, PageTabs } from "@/components/page-parts";
import { useApiQuery } from "@/hooks/use-api-query";
import { api } from "@/lib/api";
import { reconcileServerSetupStatus } from "@/lib/server-preparation-status";
import { formatDate } from "./dashboard-overview";
import {
  ServerHostCapacity,
  ServerRuntimeCapacityTable,
} from "./server-capacity";
import { useSourceBreadcrumbs } from "./source-breadcrumbs";

type DiscoveredKey = {
  algorithm: string;
  fingerprint: string;
  publicKey: string;
};

type HostKeyRow = {
  algorithm: string;
  fingerprint: string;
  id?: string;
  publicKey?: string;
  status: "trusted" | "untrusted";
};

const SERVER_CHECK_PAGE_SIZE = 10;

export function ServerDetail() {
  const { serverId, sourceId } = useParams<{
    serverId: string;
    sourceId: string;
  }>();
  const server = useApiQuery<{
    canCleanupOrphans: boolean;
    server: Server;
  }>(`/v1/core/servers/${serverId}`);
  const breadcrumbAncestors = useSourceBreadcrumbs(sourceId, {
    href: `/sources/${sourceId}?section=servers`,
    label: "Servers",
  });
  const checks = useApiQuery<ServerChecksPage>(
    `/v1/core/servers/${serverId}/checks?page=1&limit=${SERVER_CHECK_PAGE_SIZE}`,
    5_000,
  );
  const capacity = useApiQuery<{ capacity: RuntimeCapacity }>(
    `/v1/core/servers/${serverId}/capacity`,
    5_000,
  );
  const keys = useApiQuery<{ hostKeys: TrustedHostKey[] }>(
    `/v1/core/servers/${serverId}/host-keys`,
  );
  const preparations = useApiQuery<{ preparations: ServerPreparation[] }>(
    `/v1/core/servers/${serverId}/preparations`,
    3_000,
  );
  const latestPreparationStatus = preparations.data?.preparations[0]?.status;
  const refreshServer = server.refresh;
  useEffect(() => {
    if (
      latestPreparationStatus === "failed" ||
      latestPreparationStatus === "succeeded"
    ) {
      refreshServer();
    }
  }, [latestPreparationStatus, refreshServer]);
  const orphans = useApiQuery<{ orphans: OrphanItem[] }>(
    `/v1/core/servers/${serverId}/orphans`,
    5_000,
  );
  const error =
    server.error ??
    checks.error ??
    capacity.error ??
    keys.error ??
    preparations.error ??
    orphans.error;
  if (error)
    return (
      <DashboardPage breadcrumbAncestors={breadcrumbAncestors} title="Server">
        <QueryError message={error} />
      </DashboardPage>
    );
  if (
    !server.data ||
    !checks.data ||
    !capacity.data ||
    !keys.data ||
    !preparations.data ||
    !orphans.data
  )
    return (
      <DashboardPage breadcrumbAncestors={breadcrumbAncestors} title="Server">
        <QueryLoading />
      </DashboardPage>
    );

  const item = server.data.server;
  const orphanItems = orphans.data.orphans;
  const orphanVolumes = orphanItems.filter((item) => item.kind === "volume");
  const disposableOrphans = orphanItems.filter(
    (item) => item.kind !== "volume",
  );
  if (item.sourceId !== sourceId) {
    return (
      <DashboardPage breadcrumbAncestors={breadcrumbAncestors} title="Server">
        <QueryError
          message="This Server does not belong to the selected Source."
          retryable={false}
        />
      </DashboardPage>
    );
  }
  const discovered = readDiscoveredKeys(
    checks.data.latestCheck ? [checks.data.latestCheck] : [],
  );
  const trustedFingerprints = new Set(
    keys.data.hostKeys.map((key) => key.fingerprint),
  );
  const hostKeyRows: HostKeyRow[] = [
    ...keys.data.hostKeys.map((key) => ({
      algorithm: key.algorithm,
      fingerprint: key.fingerprint,
      id: key.id,
      status: "trusted" as const,
    })),
    ...discovered
      .filter((key) => !trustedFingerprints.has(key.fingerprint))
      .map((key) => ({ ...key, status: "untrusted" as const })),
  ];
  const latestCheck = checks.data.latestCheck;
  const latestPreparation = preparations.data.preparations[0];
  const setupStatus = reconcileServerSetupStatus(
    item.setupStatus,
    latestPreparation?.status,
  );
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
        check.errorMessage ? (
          <span>
            {check.errorMessage}
            <ConfigurationLinks sourceId={sourceId} serverId={serverId} />
          </span>
        ) : (
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
  const hostKeyColumns: ResourceTableColumn<HostKeyRow>[] = [
    {
      key: "algorithm",
      header: "Algorithm",
      cell: (key) => key.algorithm,
      className: "whitespace-nowrap",
    },
    {
      key: "fingerprint",
      header: "Fingerprint",
      cell: (key) => (
        <TypographyCode className="break-all">{key.fingerprint}</TypographyCode>
      ),
      className: "w-full min-w-72",
    },
    {
      key: "status",
      header: "Status",
      cell: (key) => <StatusBadge status={key.status} />,
    },
    {
      key: "action",
      header: "Action",
      cell: (key) =>
        key.status === "trusted" && key.id ? (
          <ActionButton
            action={() =>
              api.delete(`/v1/core/servers/${serverId}/host-keys/${key.id}`)
            }
            confirm={{
              actionLabel: "Untrust key",
              description:
                "Towbar will stop accepting this SSH host key. Verify and trust a replacement before the next server operation if this is the last trusted key.",
              title: (
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  <span>Untrust</span>
                  <TypographyCode className="break-all">
                    {key.fingerprint}
                  </TypographyCode>
                  <span>?</span>
                </span>
              ),
            }}
            pendingLabel="Untrusting…"
            success="Host key untrusted"
            variant="danger"
          >
            Untrust key
          </ActionButton>
        ) : key.status === "untrusted" && key.publicKey ? (
          <ActionButton
            action={() =>
              api.post(`/v1/core/servers/${serverId}/host-keys/actions/trust`, {
                algorithm: key.algorithm,
                fingerprint: key.fingerprint,
                publicKey: key.publicKey,
              })
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
        ) : (
          <span className="text-muted">—</span>
        ),
      className: "whitespace-nowrap",
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
      badge={
        <StatusBadge status={item.archivedAt ? "archived" : setupStatus} />
      }
      breadcrumbAncestors={breadcrumbAncestors}
      title={item.canonicalIp}
      titleContent={
        <span className="inline-flex min-w-0 items-center gap-2">
          <HugeiconsIcon
            aria-hidden="true"
            className="size-6 shrink-0"
            icon={ServerStack01Icon}
          />
          <span className="truncate" title={item.canonicalIp}>
            {item.canonicalIp}
          </span>
        </span>
      }
    >
      <div className="grid gap-6">
        <PageTabs
          defaultValue="overview"
          tabs={[
            {
              value: "settings",
              label: "Settings",
              icon: <HugeiconsIcon icon={Key01Icon} />,
              content: <ServerCredentials serverId={serverId} />,
            },
            {
              value: "overview",
              label: "Overview",
              icon: <HugeiconsIcon icon={ServerStack01Icon} />,
              content: (
                <div className="grid gap-8">
                  <ServerPreparationPanel
                    hasTrustedHostKey={keys.data.hostKeys.length > 0}
                    item={item}
                    latestPreparation={latestPreparation}
                    serverId={serverId}
                    setupStatus={setupStatus}
                  />
                  <ServerHostCapacity capacity={capacity.data.capacity} />
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
                      <Attributes.Item label="Server setup">
                        <StatusBadge status={setupStatus} />
                      </Attributes.Item>
                      <Attributes.Item label="Prepared">
                        {item.preparedAt
                          ? formatDate(item.preparedAt)
                          : "Not prepared"}
                      </Attributes.Item>
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
                  </div>
                </div>
              ),
            },
            {
              value: "apps-resources",
              label: "Apps/Resources",
              icon: <HugeiconsIcon icon={DashboardCircleIcon} />,
              content: (
                <ServerRuntimeCapacityTable capacity={capacity.data.capacity} />
              ),
            },
            {
              value: "host-keys",
              label: "Host Keys",
              icon: <HugeiconsIcon icon={Key01Icon} />,
              indicator: {
                label: String(hostKeyRows.length),
                variant: discovered.length ? "warning" : "secondary",
              },
              content: (
                <ResourceTable
                  ariaLabel={`Host keys for ${item.canonicalIp}`}
                  columns={hostKeyColumns}
                  emptyDescription="Run a server check to discover the SSH host keys presented by this server."
                  emptyTitle="No SSH host keys"
                  getRowKey={(key) => key.fingerprint}
                  items={hostKeyRows}
                  tableClassName="min-w-[760px]"
                />
              ),
            },
            {
              value: "checks",
              label: "Checks",
              icon: <HugeiconsIcon icon={Activity01Icon} />,
              indicator: {
                label: String(checks.data.pagination.total),
                variant: "secondary",
              },
              content: (
                <ServerCheckHistory
                  columns={checkColumns}
                  firstPage={checks.data}
                  serverId={serverId}
                  serverIp={item.canonicalIp}
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

function ServerCheckHistory({
  columns,
  firstPage,
  serverId,
  serverIp,
}: {
  columns: ResourceTableColumn<ServerCheck>[];
  firstPage: ServerChecksPage;
  serverId: string;
  serverIp: string;
}) {
  const pagination = useTablePagination({
    pageSize: firstPage.pagination.limit,
    total: firstPage.pagination.total,
  });
  const requestedPage = useApiQuery<ServerChecksPage>(
    pagination.page === 1
      ? null
      : `/v1/core/servers/${serverId}/checks?page=${pagination.page}&limit=${pagination.pageSize}`,
    5_000,
  );
  const page = pagination.page === 1 ? firstPage : requestedPage.data;

  return (
    <div className="grid gap-4">
      {requestedPage.error ? (
        <QueryError message={requestedPage.error} />
      ) : page ? (
        <ResourceTable
          ariaLabel={`${serverIp} checks`}
          columns={columns}
          emptyDescription="Run a server check to validate SSH, Docker, and the host environment."
          emptyTitle="No checks yet"
          getRowKey={(check) => check.id}
          items={page.checks}
          tableClassName="min-w-[900px]"
        />
      ) : (
        <QueryLoading />
      )}
      {firstPage.pagination.total > pagination.pageSize ? (
        <Pagination
          aria-label={`${serverIp} check history pages`}
          page={pagination.page}
          size="sm"
          totalPages={pagination.totalPages ?? 1}
          onPageChange={pagination.setPage}
        />
      ) : null}
    </div>
  );
}

function ServerPreparationPanel({
  hasTrustedHostKey,
  item,
  latestPreparation,
  serverId,
  setupStatus,
}: {
  hasTrustedHostKey: boolean;
  item: Server;
  latestPreparation: ServerPreparation | undefined;
  serverId: string;
  setupStatus: Server["setupStatus"];
}) {
  const preparing = setupStatus === "preparing";
  const ready = setupStatus === "ready";
  const steps = latestPreparation?.steps ?? [];
  const activeStep = steps.findIndex(
    (step) => step.status === "running" || step.status === "failed",
  );
  const currentStep =
    activeStep >= 0
      ? activeStep
      : steps.every((step) => step.status === "succeeded")
        ? steps.length
        : 0;
  const disabled =
    Boolean(item.archivedAt) || ready || preparing || !hasTrustedHostKey;

  return (
    <div className="grid gap-4">
      {latestPreparation?.status === "failed" &&
      latestPreparation.errorMessage ? (
        <Alert status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Server preparation stopped</Alert.Title>
            <Alert.Description>
              {latestPreparation.errorMessage}
              <ConfigurationLinks
                sourceId={item.sourceId}
                serverId={serverId}
              />
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}
      <Widget>
        <Widget.Header>
          <Widget.Title>Server preparation</Widget.Title>
          <StatusBadge status={setupStatus} />
        </Widget.Header>
        <Widget.Content className="grid gap-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <p className="max-w-2xl text-sm text-muted">
              Installs or validates Docker Engine, Caddy, Python, deployment
              directories, and SSH user access. Apps and resources stay in
              Server Setup Pending until every step succeeds.
            </p>
            <ActionButton<{ preparation: ServerPreparation }>
              action={() =>
                api.post<{ preparation: ServerPreparation }>(
                  `/v1/core/servers/${serverId}/actions/prepare`,
                )
              }
              confirm={{
                actionLabel: "Prepare server",
                description:
                  "Towbar will connect with the trusted SSH host key, install or validate Docker Engine, Caddy, and Python, then verify the host. Existing conflicting services are not removed automatically.",
                title: "Prepare this server?",
              }}
              isDisabled={disabled}
              pendingLabel="Queueing…"
              success="Server preparation queued"
              variant="primary"
            >
              Prepare Server
            </ActionButton>
          </div>
          {!hasTrustedHostKey && !ready ? (
            <p className="text-warning-soft-foreground text-sm">
              Trust at least one verified SSH host key before preparing this
              server.
            </p>
          ) : null}
          {steps.length ? (
            <Stepper
              aria-label="Server preparation progress"
              currentStep={currentStep}
              orientation="vertical"
              size="sm"
            >
              {steps.map((step) => (
                <Stepper.Step key={step.id}>
                  <Stepper.Indicator />
                  <Stepper.Content>
                    <Stepper.Title>
                      <span className="inline-flex min-w-0 items-center gap-2">
                        <span className="truncate">{step.title}</span>
                        <StatusBadge status={step.status} />
                      </span>
                    </Stepper.Title>
                    {step.message ? (
                      <Stepper.Description>{step.message}</Stepper.Description>
                    ) : null}
                  </Stepper.Content>
                  <Stepper.Separator />
                </Stepper.Step>
              ))}
            </Stepper>
          ) : null}
        </Widget.Content>
      </Widget>
    </div>
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
  const failed = checks[0];
  if (failed?.errorCode !== "HOST_KEY_NOT_TRUSTED") return [];
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
  check: ServerCheck | null | undefined,
  key: "dockerVersion" | "operatingSystem",
) {
  const value = check?.result?.[key];
  return typeof value === "string" ? value : null;
}
