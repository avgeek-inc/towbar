"use client";

import type { ReactNode } from "react";
import {
  allocatedCpuPercent,
  allocatedMemoryPercent,
} from "@/lib/allocated-capacity";
import { ServerStack01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import type {
  App,
  Resource,
  RuntimeCapacity,
  SystemHealthStatus,
} from "@workspace/towbar-web-client";
import { Chip } from "@workspace/web-design-system/data-display/chip";
import { EmptyState } from "@workspace/web-design-system/data-display/empty-state";
import { Table } from "@workspace/web-design-system/data-display/table";
import { Widget } from "@workspace/web-design-system/data-display/widget";
import { cn } from "@workspace/web-design-system/lib/utils";
import { TypographyHeading } from "@workspace/web-design-system/typography/typography";
import { StatusBadge } from "@workspace/towbar-web-ui/status-badge";

import { AppIdentity, ResourceIdentity } from "./deployable-identity";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import { useApiQuery } from "@/hooks/use-api-query";
import {
  DefinedResourceLimit,
  type DefinedLimits,
} from "./defined-resource-limit";
import { RelativeTime } from "./last-synced-time";
import { formatDate } from "./dashboard-overview";
import { formatBytes } from "./runtime-operations";

type MeterStatus = "healthy" | "attention" | "critical";
export type RuntimeMetric = RuntimeCapacity["runtimes"][number];

const capacityStatusPresentation = {
  attention: { label: "Attention", variant: "warning" as const },
  critical: { label: "Critical", variant: "destructive" as const },
  healthy: { label: "Healthy", variant: "success" as const },
  unknown: { label: "Not checked", variant: "secondary" as const },
};

export function ServerHostCapacity({
  capacity,
}: {
  capacity: RuntimeCapacity;
}) {
  return (
    <Widget>
      <Widget.Header
        className="flex-wrap"
        endContent={<CapacityStatusBadge status={capacity.status} />}
      >
        <Widget.Title icon={<HugeiconsIcon icon={ServerStack01Icon} />}>
          Host capacity
        </Widget.Title>
      </Widget.Header>
      <Widget.Content>
        {capacity.cpu && capacity.memory && capacity.disk ? (
          <div className="content-grid md:grid-cols-2 xl:grid-cols-4">
            <CapacityMeter
              detail={`${capacity.cpu.logicalCount} vCPU · load ${capacity.cpu.loadAverage1m.toFixed(2)}`}
              label="CPU"
              status={meterStatus(capacity.cpu.usagePercent, 75, 90)}
              value={capacity.cpu.usagePercent}
            />
            <CapacityMeter
              detail={`${formatBytes(capacity.memory.availableBytes)} available`}
              label="Memory"
              status={meterStatus(capacity.memory.usedPercent, 85, 95)}
              value={capacity.memory.usedPercent}
            />
            <CapacityMeter
              detail={`${formatBytes(capacity.disk.availableBytes)} available`}
              label="Docker disk"
              status={meterStatus(capacity.disk.usedPercent, 85, 95)}
              value={capacity.disk.usedPercent}
            />
            <CapacityValue
              detail="Since the latest host boot"
              label="Host uptime"
              value={
                capacity.uptimeSeconds === null
                  ? "—"
                  : formatDuration(capacity.uptimeSeconds)
              }
            />
          </div>
        ) : (
          <p className="text-sm text-muted">
            Run a server check after upgrading Towbar to collect capacity
            metrics.
          </p>
        )}
      </Widget.Content>
      <Widget.Footer>
        <Widget.FooterDescription>
          {capacity.checkedAt
            ? `Last checked ${formatDate(capacity.checkedAt)}`
            : "Not checked yet"}
        </Widget.FooterDescription>
      </Widget.Footer>
    </Widget>
  );
}

export function ServerDeployableTable({
  capacity,
  kind,
}: {
  capacity: RuntimeCapacity;
  kind: "app" | "resource";
}) {
  const apps = useApiQuery<{ apps: App[] }>(
    kind === "app" ? "/v1/core/apps" : null,
    5_000,
  );
  const resources = useApiQuery<{ resources: Resource[] }>(
    kind === "resource" ? "/v1/core/resources" : null,
    5_000,
  );
  const error = kind === "app" ? apps.error : resources.error;
  const inventory =
    kind === "app" ? apps.data?.apps : resources.data?.resources;
  if (error) return <QueryError message={error} />;
  if (!inventory) return <QueryLoading variant="table" />;
  const items = inventory.filter(
    (item) => item.serverIp === capacity.ip && !item.archivedAt,
  );
  const runtimeById = new Map(
    capacity.runtimes.map((runtime) => [runtime.id, runtime]),
  );
  const label = kind === "app" ? "App" : "Resource";
  if (!items.length) {
    return (
      <EmptyState>
        <EmptyState.Header>
          <EmptyState.Title>No {label.toLowerCase()}s</EmptyState.Title>
          <EmptyState.Description>
            No active {label.toLowerCase()}s are assigned to this server.
          </EmptyState.Description>
        </EmptyState.Header>
      </EmptyState>
    );
  }

  return (
    <Table>
      <Table.ScrollContainer>
        <Table.Content aria-label={`${label} capacity`}>
          <Table.Header>
            <Table.Column isRowHeader>{label}</Table.Column>
            <Table.Column>Health</Table.Column>
            <Table.Column>Allocated CPU</Table.Column>
            <Table.Column>Allocated Memory</Table.Column>
            <Table.Column className="text-right">Restarts</Table.Column>
            <Table.Column>Started</Table.Column>
          </Table.Header>
          <Table.Body>
            {items.map((item) => {
              const runtime = runtimeById.get(item.id);
              const healthStatus =
                runtime?.healthStatus ?? item.runtimeState.healthStatus;
              return (
                <Table.Row id={item.id} key={item.id}>
                  <Table.Cell>
                    <div className="min-w-80">
                      {item.kind === "app" ? (
                        <AppIdentity app={item} healthStatus={healthStatus} />
                      ) : (
                        <ResourceIdentity
                          resource={item}
                          healthStatus={healthStatus}
                        />
                      )}
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    <StatusBadge status={healthStatus} />
                  </Table.Cell>
                  <Table.Cell>
                    <DefinedCpuCapacity
                      runtime={runtime}
                      limits={item.config.container.resources}
                    />
                  </Table.Cell>
                  <Table.Cell>
                    <DefinedMemoryCapacity
                      runtime={runtime}
                      limits={item.config.container.resources}
                    />
                  </Table.Cell>
                  <Table.Cell className="text-right tabular-nums">
                    {runtime?.restartCount ?? "—"}
                  </Table.Cell>
                  <Table.Cell className="whitespace-nowrap">
                    {runtime?.startedAt ? (
                      <RelativeTime label="Started" value={runtime.startedAt} />
                    ) : (
                      "—"
                    )}
                  </Table.Cell>
                </Table.Row>
              );
            })}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  );
}

type DefinedCapacityProps = {
  limits: DefinedLimits;
  runtime?: RuntimeMetric;
  unavailable?: boolean;
};

export function DefinedCpuCapacity(props: DefinedCapacityProps) {
  return (
    <AllocatedCapacityMeter
      {...props}
      metric="cpu"
      percent={allocatedCpuPercent(
        props.runtime?.cpuPercent,
        props.limits?.cpus,
      )}
    />
  );
}

export function DefinedMemoryCapacity(props: DefinedCapacityProps) {
  return (
    <AllocatedCapacityMeter
      {...props}
      metric="memory"
      percent={allocatedMemoryPercent(
        props.runtime?.memoryUsageBytes,
        props.limits?.memory,
      )}
    />
  );
}

function AllocatedCapacityMeter({
  limits,
  runtime,
  unavailable,
  metric,
  percent,
}: DefinedCapacityProps & {
  metric: "cpu" | "memory";
  percent: number | null;
}) {
  return (
    <CompactMeter
      label={`${runtime?.name ?? "Workload"} allocated ${metric === "cpu" ? "CPU" : "memory"} used`}
      value={percent}
      valueLabel={percent === null ? "—" : `${percent.toFixed(1)}%`}
      endLabel={
        <DefinedResourceLimit
          limits={limits}
          metric={metric}
          unavailable={unavailable}
        />
      }
      status={
        metric === "cpu"
          ? meterStatus(percent ?? 0, 75, 90)
          : meterStatus(percent ?? 0, 85, 95)
      }
    />
  );
}

export function ServerHostMeter({
  capacity,
  metric,
}: {
  capacity?: RuntimeCapacity;
  metric: "cpu" | "disk" | "memory";
}) {
  const presentation =
    metric === "cpu" && capacity?.cpu
      ? {
          label: "CPU",
          status: meterStatus(capacity.cpu.usagePercent, 75, 90),
          value: capacity.cpu.usagePercent,
        }
      : metric === "memory" && capacity?.memory
        ? {
            label: "Memory",
            status: meterStatus(capacity.memory.usedPercent, 85, 95),
            value: capacity.memory.usedPercent,
          }
        : metric === "disk" && capacity?.disk
          ? {
              label: "Docker disk",
              status: meterStatus(capacity.disk.usedPercent, 85, 95),
              value: capacity.disk.usedPercent,
            }
          : null;
  if (!capacity || !presentation) {
    return <span className="text-muted">—</span>;
  }
  return (
    <CompactMeter
      label={`${capacity.ip} ${presentation.label} used`}
      status={presentation.status}
      value={presentation.value}
      valueLabel={`${presentation.value.toFixed(1)}%`}
    />
  );
}

export function ServerUptime({ capacity }: { capacity?: RuntimeCapacity }) {
  return (
    <span className="whitespace-nowrap tabular-nums">
      {capacity?.uptimeSeconds === null || capacity?.uptimeSeconds === undefined
        ? "—"
        : formatDuration(capacity.uptimeSeconds)}
    </span>
  );
}

function CapacityValue({
  detail,
  label,
  value,
}: {
  detail: string;
  label: string;
  value: string;
}) {
  return (
    <div className="grid content-start gap-0.5">
      <span className="text-sm font-medium">{label}</span>
      <TypographyHeading
        className="font-medium leading-5 tabular-nums"
        level={5}
      >
        {value}
      </TypographyHeading>
      <span className="text-xs text-muted">{detail}</span>
    </div>
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
  status: MeterStatus;
  value: number;
}) {
  return (
    <div className="grid gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-sm tabular-nums">{value.toFixed(1)}%</span>
      </div>
      <MeterBar label={`${label} used`} status={status} value={value} />
      <span className="text-xs text-muted">{detail}</span>
    </div>
  );
}

function CompactMeter({
  label,
  status,
  value,
  valueLabel,
  endLabel,
}: {
  label: string;
  status: MeterStatus;
  value: number | null;
  valueLabel: string;
  endLabel?: ReactNode;
}) {
  return (
    <div className="grid min-w-36 gap-1.5">
      <span className="flex items-center justify-between gap-3 whitespace-nowrap text-xs tabular-nums">
        <span>{valueLabel}</span>
        {endLabel}
      </span>
      <MeterBar label={label} size="compact" status={status} value={value} />
    </div>
  );
}

function MeterBar({
  label,
  size = "default",
  status,
  value,
}: {
  label: string;
  size?: "compact" | "default";
  status: MeterStatus;
  value: number | null;
}) {
  const color =
    status === "critical"
      ? "bg-danger"
      : status === "attention"
        ? "bg-warning"
        : "bg-success";
  const clamped = Math.max(0, Math.min(100, value ?? 0));
  return (
    <div
      aria-label={label}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={value === null ? undefined : Math.round(clamped)}
      aria-valuetext={
        value === null ? "Usage unavailable" : `${value.toFixed(1)}%`
      }
      className={cn(
        "overflow-hidden rounded-full bg-separator",
        size === "compact" ? "h-1.5" : "h-2",
      )}
      role="progressbar"
    >
      <div
        className={cn("h-full rounded-full", color)}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

function CapacityStatusBadge({ status }: { status: SystemHealthStatus }) {
  const presentation = capacityStatusPresentation[status];
  return <Chip variant={presentation.variant}>{presentation.label}</Chip>;
}

function meterStatus(
  value: number,
  attention: number,
  critical: number,
): MeterStatus {
  return value >= critical
    ? "critical"
    : value >= attention
      ? "attention"
      : "healthy";
}

function formatDuration(seconds: number) {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  if (days) return `${days}d ${hours}h`;
  const minutes = Math.floor((seconds % 3_600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}
