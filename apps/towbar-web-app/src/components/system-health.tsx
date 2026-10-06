"use client";
import { Spinner } from "@avgeek-oss/design-system/feedback/spinner";
import { useState } from "react";
import { HostUpgrade } from "./host-upgrade";
import { upgradeIsActive, upgradeNeedsRecovery } from "./host-upgrade-state";
import {
  AlertCircleIcon,
  ArrowRight01Icon,
  CheckmarkCircle02Icon,
  HealthIcon,
  InformationCircleIcon,
  ReloadIcon,
} from "@hugeicons/core-free-icons";

import { TooltipText } from "@avgeek-oss/design-system/overlays/tooltip";
import { LineChart } from "@avgeek-oss/design-system/charts/line-chart";

import { HugeiconsIcon } from "@hugeicons/react";

import type {
  SystemHealth,
  SystemHealthCheck,
  SystemHealthStatus,
  TowbarUpdateInfo,
  TowbarUpgradeJob,
} from "@workspace/towbar-web-client";
import { ButtonLink } from "@avgeek-oss/design-system/buttons/button";
import { Chip } from "@avgeek-oss/design-system/data-display/chip";
import { Widget } from "@avgeek-oss/design-system/data-display/widget";
import { cn } from "@avgeek-oss/design-system/lib/utils";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";

import { ActionButton, DashboardPage } from "@/components/page-parts";
import { useApiQuery } from "@/hooks/use-api-query";
import { api } from "@/lib/api";
import { displayChartDate, displayDateTime } from "@/lib/date-time-display";
import {
  useLocalizedChartTicks,
  useLocalizedTimestamps,
} from "@/hooks/use-localized-timestamps";
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
    variant: "danger" as const,
  },
  healthy: {
    icon: CheckmarkCircle02Icon,
    label: "Healthy",
    text: "text-success-soft-foreground",
    variant: "success" as const,
  },
  unknown: {
    icon: InformationCircleIcon,
    label: "Not checked",
    text: "text-muted",
    variant: "default" as const,
  },
};

export function SystemHealthPage() {
  const query = useApiQuery<SystemHealth>("/v1/core/system-health", 15_000);
  const updateQuery = useApiQuery<TowbarUpdateInfo>(
    "/v1/core/version",
    15 * 60_000,
  );
  if (query.error && !query.data) {
    return (
      <DashboardPage icon={HealthIcon} title="System health">
        <QueryError message={query.error} />
        <HostUpgrade />
      </DashboardPage>
    );
  }
  if (!query.data) {
    return (
      <DashboardPage icon={HealthIcon} title="System health">
        <QueryLoading variant="dashboard" />
      </DashboardPage>
    );
  }
  const health = query.data;
  return (
    <DashboardPage
      icon={HealthIcon}
      actions={
        <ActionButton<SystemHealth>
          confirm={{
            title: "Run system checks?",
            description: "Run fresh checks against the Towbar control plane.",
            actionLabel: "Run checks",
          }}
          action={() => api.post("/v1/core/system-health/actions/check")}
          onSuccess={() => query.refresh()}
          pendingLabel="Running checks…"
          success="System checks completed"
          variant="primary"
        >
          <HugeiconsIcon
            aria-hidden="true"
            icon={ReloadIcon}
            className="size-4 shrink-0"
          />
          Run checks
        </ActionButton>
      }
      title="System health"
    >
      <HealthChecks
        checks={health.checks}
        title="Control plane"
        version={health.version}
        updates={updateQuery.data}
        updateError={Boolean(updateQuery.error)}
      />
      <DatabaseStorage storage={health.databaseStorage} />
    </DashboardPage>
  );
}

function DatabaseStorage({
  storage,
}: {
  storage: SystemHealth["databaseStorage"];
}) {
  const data = storage.map((sample) => ({
    at: new Date(sample.sampledAt).getTime(),
    towbarBytes: sample.towbarBytes,
    monitoringBytes: sample.monitoringBytes,
  }));
  const first = data[0];
  const latest = data.at(-1);
  const start = first?.at ?? Date.now() - 90 * 24 * 60 * 60_000;
  const end = latest?.at ?? Date.now();
  const { ticks, error: dateLabelError } = useLocalizedChartTicks(start, end);
  useLocalizedTimestamps(storage.map((sample) => sample.sampledAt));
  return (
    <Widget>
      <Widget.Header
        endContent={
          latest ? (
            <span className="text-xs tabular-nums text-muted">
              Total {formatBytes(latest.towbarBytes + latest.monitoringBytes)}
            </span>
          ) : null
        }
      >
        <Widget.Title>Database storage</Widget.Title>
      </Widget.Header>
      <Widget.Content className="grid min-w-0 gap-3">
        {dateLabelError ? <QueryError message={dateLabelError} /> : null}
        {latest ? (
          <>
            <LineChart
              aria-label="Towbar and Scout monitoring database storage over the last 90 days"
              chartMargin={{ bottom: 0, left: -8 }}
              data={data}
              height={240}
            >
              <LineChart.Grid vertical={false} />
              <LineChart.XAxis
                dataKey="at"
                type="number"
                scale="time"
                domain={[start, Math.max(start + 1, end)]}
                ticks={ticks}
                tickFormatter={displayChartDate}
                minTickGap={45}
                tick={{ fontSize: 11 }}
              />
              <LineChart.YAxis
                width={75}
                domain={[0, "auto"]}
                tickFormatter={(value) => formatBytes(Number(value))}
                tick={{ fontSize: 11 }}
              />
              <LineChart.Line
                dataKey="towbarBytes"
                name="Towbar Data"
                stroke="var(--chart-requested)"
                strokeWidth={2}
                dot={data.length === 1 ? { r: 3 } : false}
                isAnimationActive={false}
                type="monotone"
              />
              <LineChart.Line
                dataKey="monitoringBytes"
                name="Monitoring Data"
                stroke="var(--warning)"
                strokeWidth={2}
                dot={data.length === 1 ? { r: 3 } : false}
                isAnimationActive={false}
                type="monotone"
              />
              <LineChart.Tooltip
                content={
                  <LineChart.TooltipContent
                    labelFormatter={(value) => displayDateTime(Number(value))}
                    valueFormatter={(value) => formatBytes(Number(value))}
                  />
                }
              />
            </LineChart>
            <Widget.Legend className="flex-wrap">
              <Widget.LegendItem color="var(--chart-requested)">
                Towbar Data
              </Widget.LegendItem>
              <Widget.LegendItem color="var(--warning)">
                Monitoring Data
              </Widget.LegendItem>
            </Widget.Legend>
          </>
        ) : (
          <p className="text-sm text-muted">
            Waiting for the first database storage reading.
          </p>
        )}
      </Widget.Content>
    </Widget>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB", "TiB", "PiB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length,
  );
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(bytes / 1024 ** exponent)} ${units[exponent - 1]}`;
}

function HealthChecks({
  checks,
  version,
  title,
  updates,
  updateError,
}: {
  checks: SystemHealthCheck[];
  version?: string;
  title: string;
  updates?: TowbarUpdateInfo;
  updateError: boolean;
}) {
  return (
    <Widget>
      <Widget.Header>
        <Widget.Title>{title}</Widget.Title>
      </Widget.Header>
      <Widget.Content className="grid p-0">
        {checks.map((check) => {
          const stale = isCheckStale(check);
          const presentation =
            statusPresentation[stale ? "attention" : check.status];
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
                    <HealthStatusChip
                      checkedAt={check.checkedAt}
                      stale={stale}
                      status={check.status}
                    />
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
                  <HugeiconsIcon
                    aria-hidden="true"
                    icon={ArrowRight01Icon}
                    className="size-4 shrink-0"
                  />
                  {check.remediationLabel}
                </ButtonLink>
              ) : null}
            </div>
          );
        })}
        <TowbarUpdates updates={updates} error={updateError} />
      </Widget.Content>
      {version ? (
        <Widget.Footer>
          <Widget.FooterDescription>
            Version{" "}
            <TooltipText className="font-mono" tooltip={version}>
              {shortVersion(version)}
            </TooltipText>
          </Widget.FooterDescription>
        </Widget.Footer>
      ) : null}
    </Widget>
  );
}

function TowbarUpdates({
  updates,
  error,
}: {
  updates?: TowbarUpdateInfo;
  error: boolean;
}) {
  const [job, setJob] = useState<TowbarUpgradeJob>();
  const active = upgradeIsActive(job?.state);
  const recovery = upgradeNeedsRecovery(job?.state);
  const status = error ? "unavailable" : updates?.status;
  const description =
    active && job
      ? `Towbar is upgrading from ${job.currentVersion} to ${job.targetVersion}.`
      : status === "unavailable"
        ? "The latest release could not be checked. Try again later."
        : !updates
          ? "Checking the latest published stable release."
          : status === "available"
            ? `You’re running Towbar v${updates.installedVersion}. An upgrade to v${updates.latestVersion} is available.`
            : status === "current"
              ? `This installation runs the latest stable release, v${updates.installedVersion}.`
              : `This installation runs v${updates.installedVersion}, ahead of the latest stable release v${updates.latestVersion}.`;
  return (
    <div className="grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="flex min-w-0 items-start gap-3">
        <HugeiconsIcon
          aria-hidden="true"
          className={cn(
            "mt-0.5 size-5 shrink-0",
            recovery
              ? "text-danger-soft-foreground"
              : status === "current"
                ? "text-success-soft-foreground"
                : "text-muted",
          )}
          icon={ReloadIcon}
        />
        <div className="grid min-w-0 gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-medium">Towbar version</h3>
            {recovery ? (
              <Chip color="danger">
                <Chip.Label className="inline-flex items-center gap-1.5 whitespace-nowrap [&_svg]:size-3.5">
                  Recovery required
                </Chip.Label>
              </Chip>
            ) : active ? (
              <Chip color="warning">
                <Chip.Label className="inline-flex items-center gap-1.5 whitespace-nowrap [&_svg]:size-3.5">
                  <Spinner size="sm" color="current" />
                  Upgrade in progress
                </Chip.Label>
              </Chip>
            ) : status === "available" ? (
              <Chip color="warning">
                <Chip.Label className="inline-flex items-center gap-1.5 whitespace-nowrap [&_svg]:size-3.5">
                  Update available
                </Chip.Label>
              </Chip>
            ) : null}
          </div>
          <p className="text-sm text-muted">{description}</p>
          {updates?.checkedAt ? (
            <p className="text-xs text-muted">
              Checked {formatDate(updates.checkedAt)}
            </p>
          ) : null}
        </div>
      </div>
      <HostUpgrade
        targetVersion={status === "available" ? updates?.latestVersion : null}
        onJobChange={setJob}
      />
    </div>
  );
}

function HealthStatusChip({
  checkedAt,
  stale = false,
  status,
  tooltip,
}: {
  checkedAt?: string | null;
  stale?: boolean;
  status: SystemHealthStatus;
  tooltip?: string;
}) {
  const presentation = statusPresentation[stale ? "attention" : status];
  return (
    <TooltipText
      className="inline-flex"
      tooltip={
        tooltip ??
        (checkedAt
          ? `${stale ? "This result is stale. Last checked" : "Last checked"} ${formatDate(checkedAt)}.`
          : "This check has not run yet.")
      }
    >
      <Chip color={presentation.variant}>
        <Chip.Label className="inline-flex items-center gap-1.5 whitespace-nowrap [&_svg]:size-3.5">
          <HugeiconsIcon aria-hidden icon={presentation.icon} />
          {stale ? "Checks stale" : presentation.label}
        </Chip.Label>
      </Chip>
    </TooltipText>
  );
}

function isCheckStale(check: SystemHealthCheck) {
  if (!check.checkedAt) return true;
  return Date.now() - new Date(check.checkedAt).getTime() > 15 * 60 * 1000;
}

function shortVersion(version: string) {
  return /^[a-f0-9]{40}$/u.test(version) ? version.slice(0, 12) : version;
}
