"use client";

import {
  AlertCircleIcon,
  CheckmarkCircle02Icon,
  HealthIcon,
  InformationCircleIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import type {
  SystemHealth,
  SystemHealthCheck,
  SystemHealthStatus,
} from "@workspace/towbar-web-client";
import { ButtonLink } from "@workspace/web-design-system/buttons/button";
import { Chip } from "@workspace/web-design-system/data-display/chip";
import { Widget } from "@workspace/web-design-system/data-display/widget";
import { cn } from "@workspace/web-design-system/lib/utils";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";

import { ActionButton, DashboardPage } from "@/components/page-parts";
import { useApiQuery } from "@/hooks/use-api-query";
import { api } from "@/lib/api";
import { formatDate } from "./dashboard-overview";

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
    </DashboardPage>
  );
}

function HealthSummary({ health }: { health: SystemHealth }) {
  const presentation = statusPresentation[health.status];
  const issues = health.checks.filter(
    (check) => check.status === "attention" || check.status === "critical",
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

function HealthStatusChip({ status }: { status: SystemHealthStatus }) {
  const presentation = statusPresentation[status];
  return <Chip variant={presentation.variant}>{presentation.label}</Chip>;
}

function shortVersion(version: string) {
  return /^[a-f0-9]{40}$/u.test(version) ? version.slice(0, 12) : version;
}

function healthSummaryDescription(input: {
  issues: number;
  status: SystemHealthStatus;
}) {
  if (input.status === "healthy") {
    return "The API, worker, workflow engine, and connected providers are operational.";
  }
  if (input.status === "unknown") {
    return "Run checks to establish a current control-plane baseline.";
  }
  return `${input.issues} control-plane ${input.issues === 1 ? "check needs" : "checks need"} review.`;
}
