"use client";

import {
  AlertCircleIcon,
  CheckmarkCircle02Icon,
  HealthIcon,
  InformationCircleIcon,
  ServerStack01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import Link from "next/link";

import type {
  RuntimeCapacity,
  SystemHealth,
  SystemHealthCheck,
  SystemHealthStatus,
} from "@workspace/towbar-web-client";
import { ButtonLink } from "@workspace/web-design-system/buttons/button";
import { Chip } from "@workspace/web-design-system/data-display/chip";
import { EmptyState } from "@workspace/web-design-system/data-display/empty-state";
import { Table } from "@workspace/web-design-system/data-display/table";
import { Widget } from "@workspace/web-design-system/data-display/widget";
import { cn } from "@workspace/web-design-system/lib/utils";
import { StatusBadge } from "@workspace/towbar-web-ui/status-badge";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";

import { ActionButton, DashboardPage } from "@/components/page-parts";
import { useApiQuery } from "@/hooks/use-api-query";
import { api } from "@/lib/api";
import { formatDate } from "./dashboard-overview";
import { formatBytes } from "./runtime-operations";

const statusPresentation = {
  attention: {
    icon: AlertCircleIcon,
    label: "Attention",
    text: "text-warning",
    variant: "warning" as const,
  },
  critical: {
    icon: AlertCircleIcon,
    label: "Critical",
    text: "text-danger",
    variant: "destructive" as const,
  },
  healthy: {
    icon: CheckmarkCircle02Icon,
    label: "Healthy",
    text: "text-success",
    variant: "success" as const,
  },
  unknown: {
    icon: InformationCircleIcon,
    label: "Not checked",
    text: "text-muted",
    variant: "secondary" as const,
  },
};

export function SystemHealthPage() {
  const query = useApiQuery<SystemHealth>("/v1/core/system-health", 15_000);
  if (query.error) {
    return (
      <DashboardPage title="System health">
        <QueryError message={query.error} />
      </DashboardPage>
    );
  }
  if (!query.data) {
    return (
      <DashboardPage title="System health">
        <QueryLoading variant="dashboard" />
      </DashboardPage>
    );
  }
  const health = query.data;
  return (
    <DashboardPage
      actions={
        <ActionButton<SystemHealth>
          action={() => api.post("/v1/core/system-health/actions/check")}
          onSuccess={() => query.refresh()}
          pendingLabel="Running checks…"
          success="System checks completed"
          variant="primary"
        >
          Run checks
        </ActionButton>
      }
      badge={<HealthStatusChip status={health.status} />}
      title="System health"
      titleContent={
        <span className="inline-flex min-w-0 items-center gap-3">
          <HugeiconsIcon
            aria-hidden="true"
            className="size-8 shrink-0"
            icon={HealthIcon}
          />
          <span>System health</span>
        </span>
      }
    >
      <HealthSummary health={health} />
      <ControlPlane checks={health.checks} version={health.version} />
      <RuntimeCapacitySection servers={health.runtimeCapacity} />
    </DashboardPage>
  );
}

function HealthSummary({ health }: { health: SystemHealth }) {
  const presentation = statusPresentation[health.status];
  const issues = health.checks.filter(
    (check) => check.status === "attention" || check.status === "critical",
  ).length;
  const runtimeIssues = health.runtimeCapacity.filter(
    (server) => server.status === "attention" || server.status === "critical",
  ).length;
  const title =
    health.status === "healthy"
      ? "All systems operational"
      : health.status === "unknown"
        ? "Run the first system check"
        : health.status === "critical"
          ? "Immediate attention required"
          : "Operational attention recommended";
  const description = healthSummaryDescription({
    issues,
    runtimeIssues,
    status: health.status,
  });
  return (
    <div className="flex flex-col gap-4 rounded-3xl border border-separator bg-surface p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <HugeiconsIcon
          aria-hidden="true"
          className={cn("mt-0.5 size-6 shrink-0", presentation.text)}
          icon={presentation.icon}
        />
        <div className="grid min-w-0 gap-1">
          <h2 className="text-lg font-medium">{title}</h2>
          <p className="max-w-3xl text-sm text-muted">{description}</p>
        </div>
      </div>
      <p className="shrink-0 text-xs text-muted">
        Snapshot {formatDate(health.checkedAt)}
      </p>
    </div>
  );
}

function ControlPlane({
  checks,
  version,
}: {
  checks: SystemHealthCheck[];
  version: string;
}) {
  return (
    <Widget>
      <Widget.Header>
        <Widget.Title>Control plane</Widget.Title>
        <span className="font-mono text-xs text-muted" title={version}>
          {shortVersion(version)}
        </span>
      </Widget.Header>
      <Widget.Content className="grid p-0">
        {checks.map((check) => {
          const presentation = statusPresentation[check.status];
          return (
            <div
              className="grid gap-3 border-b border-separator px-5 py-4 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
              key={check.id}
            >
              <div className="flex min-w-0 items-start gap-3">
                <HugeiconsIcon
                  aria-hidden="true"
                  className={cn("mt-0.5 size-5 shrink-0", presentation.text)}
                  icon={presentation.icon}
                />
                <div className="grid min-w-0 gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-medium">{check.title}</h3>
                    <HealthStatusChip status={check.status} />
                  </div>
                  <p className="text-sm text-muted">{check.description}</p>
                  {check.checkedAt ? (
                    <p className="text-xs text-muted">
                      Checked {formatDate(check.checkedAt)}
                    </p>
                  ) : null}
                </div>
              </div>
              {check.remediationHref && check.remediationLabel ? (
                <ButtonLink href={check.remediationHref} variant="secondary">
                  {check.remediationLabel}
                </ButtonLink>
              ) : null}
            </div>
          );
        })}
      </Widget.Content>
    </Widget>
  );
}

function RuntimeCapacitySection({ servers }: { servers: RuntimeCapacity[] }) {
  const runtimes = servers.flatMap((server) =>
    server.runtimes.map((runtime) => ({ runtime, server })),
  );
  return (
    <div className="grid gap-3">
      <div>
        <h2 className="text-lg font-medium">Runtime capacity</h2>
        <p className="mt-1 text-sm text-muted">
          Host pressure and managed-container usage from retained server checks.
        </p>
      </div>
      {servers.length ? (
        <div className="grid gap-4">
          {servers.map((server) => (
            <ServerCapacityCard key={server.id} server={server} />
          ))}
          {runtimes.length ? <ManagedRuntimesTable rows={runtimes} /> : null}
        </div>
      ) : (
        <Widget>
          <Widget.Content>
            <EmptyState>
              <EmptyState.Header>
                <EmptyState.Title>No active servers</EmptyState.Title>
                <EmptyState.Description>
                  Add a Source with a Server to begin collecting capacity data.
                </EmptyState.Description>
              </EmptyState.Header>
              <EmptyState.Content>
                <ButtonLink href="/sources" variant="secondary">
                  Open Sources
                </ButtonLink>
              </EmptyState.Content>
            </EmptyState>
          </Widget.Content>
        </Widget>
      )}
    </div>
  );
}

function ServerCapacityCard({ server }: { server: RuntimeCapacity }) {
  const unhealthy = server.runtimes.filter(
    (runtime) => runtime.healthStatus === "unhealthy",
  ).length;
  const restarts = server.runtimes.reduce(
    (total, runtime) => total + (runtime.restartCount ?? 0),
    0,
  );
  return (
    <Widget>
      <Widget.Header className="flex-wrap">
        <div className="flex min-w-0 items-center gap-2">
          <HugeiconsIcon
            aria-hidden="true"
            className="size-4 shrink-0 text-muted"
            icon={ServerStack01Icon}
          />
          <Link
            className="truncate text-sm font-medium underline-offset-4 hover:underline"
            href={`/sources/${server.sourceId}/servers/${server.id}`}
          >
            {server.ip}
          </Link>
          <HealthStatusChip status={server.status} />
        </div>
        <span className="text-xs text-muted">
          {server.checkedAt
            ? `Checked ${formatDate(server.checkedAt)}`
            : "Not checked"}
        </span>
      </Widget.Header>
      <Widget.Content className="grid gap-5">
        {server.cpu && server.memory && server.disk ? (
          <div className="grid gap-4 md:grid-cols-3">
            <CapacityMeter
              detail={`${server.cpu.logicalCount} vCPU · load ${server.cpu.loadAverage1m.toFixed(2)}`}
              label="CPU"
              status={meterStatus(server.cpu.usagePercent, 75, 90)}
              value={server.cpu.usagePercent}
            />
            <CapacityMeter
              detail={`${formatBytes(server.memory.availableBytes)} available`}
              label="Memory"
              status={meterStatus(server.memory.usedPercent, 85, 95)}
              value={server.memory.usedPercent}
            />
            <CapacityMeter
              detail={`${formatBytes(server.disk.availableBytes)} available`}
              label="Docker disk"
              status={meterStatus(server.disk.usedPercent, 85, 95)}
              value={server.disk.usedPercent}
            />
          </div>
        ) : (
          <p className="text-sm text-muted">
            Run a server check after upgrading Towbar to collect capacity
            metrics.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
          <span>{server.runtimes.length} managed runtimes</span>
          <span>
            {unhealthy ? `${unhealthy} unhealthy` : "All health checks passing"}
          </span>
          <span>
            {restarts
              ? `${restarts} recorded restarts`
              : "No recorded restarts"}
          </span>
          {server.uptimeSeconds !== null ? (
            <span>Host up {formatDuration(server.uptimeSeconds)}</span>
          ) : null}
        </div>
      </Widget.Content>
    </Widget>
  );
}

function ManagedRuntimesTable({
  rows,
}: {
  rows: Array<{
    runtime: RuntimeCapacity["runtimes"][number];
    server: RuntimeCapacity;
  }>;
}) {
  return (
    <Widget>
      <Widget.Header>
        <div className="grid gap-1">
          <Widget.Title>Managed runtimes</Widget.Title>
          <p className="text-xs text-muted">
            Current container health and usage from the latest server checks.
          </p>
        </div>
        <Chip variant="secondary">{rows.length}</Chip>
      </Widget.Header>
      <Widget.Content className="p-0">
        <Table>
          <Table.ScrollContainer>
            <Table.Content aria-label="Managed runtime capacity">
              <Table.Header>
                <Table.Column isRowHeader>Runtime</Table.Column>
                <Table.Column>Server</Table.Column>
                <Table.Column>Health</Table.Column>
                <Table.Column className="text-right">CPU</Table.Column>
                <Table.Column className="text-right">Memory</Table.Column>
                <Table.Column className="text-right">Restarts</Table.Column>
                <Table.Column>Started</Table.Column>
              </Table.Header>
              <Table.Body>
                {rows.map(({ runtime, server }) => (
                  <Table.Row
                    id={`${server.id}:${runtime.id}`}
                    key={`${server.id}:${runtime.id}`}
                  >
                    <Table.Cell>
                      <div className="grid min-w-44 gap-0.5">
                        <span className="font-medium">{runtime.name}</span>
                        <span className="text-xs capitalize text-muted">
                          {runtime.kind}
                        </span>
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      <Link
                        className="whitespace-nowrap underline-offset-4 hover:underline"
                        href={`/sources/${server.sourceId}/servers/${server.id}`}
                      >
                        {server.ip}
                      </Link>
                    </Table.Cell>
                    <Table.Cell>
                      <StatusBadge status={runtime.healthStatus} />
                    </Table.Cell>
                    <Table.Cell className="text-right tabular-nums">
                      {runtime.cpuPercent === null
                        ? "—"
                        : `${runtime.cpuPercent.toFixed(1)}%`}
                    </Table.Cell>
                    <Table.Cell className="whitespace-nowrap text-right tabular-nums">
                      {runtime.memoryUsageBytes === null
                        ? "—"
                        : formatRuntimeMemory(
                            runtime.memoryUsageBytes,
                            runtime.memoryLimitBytes,
                          )}
                    </Table.Cell>
                    <Table.Cell className="text-right tabular-nums">
                      {runtime.restartCount ?? "—"}
                    </Table.Cell>
                    <Table.Cell className="whitespace-nowrap">
                      {runtime.startedAt ? formatDate(runtime.startedAt) : "—"}
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>
      </Widget.Content>
    </Widget>
  );
}

function CapacityMeter({
  detail,
  label,
  status,
  value,
}: {
  detail: string;
  label: string;
  status: "healthy" | "attention" | "critical";
  value: number;
}) {
  const color =
    status === "critical"
      ? "bg-danger"
      : status === "attention"
        ? "bg-warning"
        : "bg-success";
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className="grid gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-sm tabular-nums">{value.toFixed(1)}%</span>
      </div>
      <div
        aria-label={`${label} used`}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={Math.round(clamped)}
        className="h-2 overflow-hidden rounded-full bg-separator"
        role="progressbar"
      >
        <div
          className={cn("h-full rounded-full", color)}
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className="text-xs text-muted">{detail}</span>
    </div>
  );
}

function HealthStatusChip({ status }: { status: SystemHealthStatus }) {
  const presentation = statusPresentation[status];
  return <Chip variant={presentation.variant}>{presentation.label}</Chip>;
}

function meterStatus(value: number, attention: number, critical: number) {
  return value >= critical
    ? "critical"
    : value >= attention
      ? "attention"
      : "healthy";
}

function formatRuntimeMemory(usage: number, limit: number | null) {
  return limit
    ? `${formatBytes(usage)} / ${formatBytes(limit)}`
    : formatBytes(usage);
}

function formatDuration(seconds: number) {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  if (days) return `${days}d ${hours}h`;
  const minutes = Math.floor((seconds % 3_600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function shortVersion(version: string) {
  return /^[a-f0-9]{40}$/u.test(version) ? version.slice(0, 12) : version;
}

function healthSummaryDescription(input: {
  issues: number;
  runtimeIssues: number;
  status: SystemHealthStatus;
}) {
  if (input.status === "healthy") {
    return "The control plane is connected and current server checks show capacity headroom.";
  }
  if (input.status === "unknown") {
    return "Run checks to establish a current control-plane and server baseline.";
  }
  const parts = [];
  if (input.issues) {
    parts.push(
      `${input.issues} control-plane ${input.issues === 1 ? "check needs" : "checks need"} review`,
    );
  } else {
    parts.push("The control plane is healthy");
  }
  if (input.runtimeIssues) {
    parts.push(
      `${input.runtimeIssues} ${input.runtimeIssues === 1 ? "server shows" : "servers show"} capacity pressure`,
    );
  } else {
    parts.push("runtime capacity is healthy");
  }
  return `${parts.join("; ")}.`;
}
