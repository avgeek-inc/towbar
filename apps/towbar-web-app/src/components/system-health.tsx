"use client";
import {
  Activity01Icon,
  AlertCircleIcon,
  ArrowRight01Icon,
  CheckmarkCircle02Icon,
  DatabaseIcon,
  HealthIcon,
  InformationCircleIcon,
  ReloadIcon,
} from "@hugeicons/core-free-icons";

import { TooltipText } from "@workspace/web-design-system/overlays/tooltip";
import { LineChart } from "@workspace/web-design-system/charts/line-chart";

import { HugeiconsIcon } from "@hugeicons/react";

import type {
  SystemHealth,
  SystemHealthCheck,
  SystemHealthStatus,
  TowbarUpdateInfo,
} from "@workspace/towbar-web-client";
import { ButtonLink } from "@workspace/web-design-system/buttons/button";
import { Chip } from "@workspace/web-design-system/data-display/chip";
import { Widget } from "@workspace/web-design-system/data-display/widget";
import { cn } from "@workspace/web-design-system/lib/utils";
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
    variant: "destructive" as const,
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
    variant: "secondary" as const,
  },
};

export function SystemHealthPage() {
  const query = useApiQuery<SystemHealth>("/v1/core/system-health", 15_000);
  const updateQuery = useApiQuery<TowbarUpdateInfo>(
    "/v1/core/version",
    15 * 60_000,
  );
  if (query.error) {
    return (
      <DashboardPage icon={HealthIcon} title="System health">
        <QueryError message={query.error} />
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
  const checksStale = health.checks.some(isCheckStale);
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
      badge={
        <HealthStatusChip
          stale={checksStale}
          status={health.status}
          tooltip={
            checksStale
              ? "One or more system checks are older than 15 minutes."
              : health.status === "healthy"
                ? "All current system checks passed."
                : "One or more current system checks need attention."
          }
        />
      }
      title="System health"
    >
      <HealthChecks
        checks={health.checks}
        title="Control plane"
        icon={Activity01Icon}
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
        <Widget.Title icon={<HugeiconsIcon icon={DatabaseIcon} />}>
          Database storage
        </Widget.Title>
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
                stroke="var(--chart-succeeded)"
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
              <Widget.LegendItem color="var(--chart-succeeded)">
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
  icon,
  updates,
  updateError,
}: {
  checks: SystemHealthCheck[];
  version?: string;
  title: string;
  icon: typeof Activity01Icon;
  updates?: TowbarUpdateInfo;
  updateError: boolean;
}) {
  return (
    <Widget>
      <Widget.Header>
        <Widget.Title icon={<HugeiconsIcon icon={icon} />}>
          {title}
        </Widget.Title>
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
  const status = error ? "unavailable" : updates?.status;
  const label =
    status === "available"
      ? "Update available"
      : status === "current"
        ? "Up to date"
        : status === "ahead"
          ? "Ahead of stable"
          : status === "unavailable"
            ? "Check unavailable"
            : "Checking";
  const description =
    status === "unavailable"
      ? "The latest release could not be checked. Try again later."
      : !updates
        ? "Checking the latest published stable release."
        : status === "available"
          ? `Towbar v${updates.latestVersion} is available. This installation runs v${updates.installedVersion}.`
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
            status === "available"
              ? "text-warning"
              : status === "current"
                ? "text-success-soft-foreground"
                : "text-muted",
          )}
          icon={ReloadIcon}
        />
        <div className="grid min-w-0 gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-medium">Towbar Updates</h3>
            <Chip
              variant={
                status === "available"
                  ? "warning"
                  : status === "current"
                    ? "success"
                    : "secondary"
              }
            >
              {label}
            </Chip>
          </div>
          <p className="text-sm text-muted">{description}</p>
        </div>
      </div>
      {status === "available" && updates?.releaseUrl ? (
        <ButtonLink
          href={updates.releaseUrl}
          target="_blank"
          rel="noopener noreferrer"
          variant="secondary"
        >
          <HugeiconsIcon
            aria-hidden="true"
            icon={ArrowRight01Icon}
            className="size-4 shrink-0"
          />
          View release
        </ButtonLink>
      ) : null}
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
    <Chip
      variant={presentation.variant}
      icon={<HugeiconsIcon icon={presentation.icon} />}
      tooltip={
        tooltip ??
        (checkedAt
          ? `${stale ? "This result is stale. Last checked" : "Last checked"} ${formatDate(checkedAt)}.`
          : "This check has not run yet.")
      }
    >
      {stale ? "Checks stale" : presentation.label}
    </Chip>
  );
}

function isCheckStale(check: SystemHealthCheck) {
  if (!check.checkedAt) return true;
  return Date.now() - new Date(check.checkedAt).getTime() > 15 * 60 * 1000;
}

function shortVersion(version: string) {
  return /^[a-f0-9]{40}$/u.test(version) ? version.slice(0, 12) : version;
}
