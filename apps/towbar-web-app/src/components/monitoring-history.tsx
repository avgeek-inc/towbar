"use client";

import { useDeferredValue, useId, useMemo, useState } from "react";
import type { MonitoringHistory as History } from "@workspace/towbar-web-client";
import { Widget } from "@workspace/web-design-system/data-display/widget";
import { Label } from "@workspace/web-design-system/forms/label";
import { ListBox, Select } from "@workspace/web-design-system/forms/select";
import { ButtonLink } from "@workspace/web-design-system/buttons/button";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import { useApiQuery } from "@/hooks/use-api-query";
import { MonitoringDocumentation } from "./monitoring-documentation";
import { MonitoringEvents } from "./monitoring-events";
import { type ChartMetric } from "./monitoring-metric-chart";
import { MonitoringChartSlot } from "./monitoring-chart-slot";
import { MonitoringStatus } from "./monitoring-agent-settings";

const ranges = [
  { id: "1h", label: "Last hour", days: 1 },
  { id: "6h", label: "Last 6 hours", days: 1 },
  { id: "24h", label: "Last 24 hours", days: 1 },
  { id: "7d", label: "Last 7 days", days: 7 },
  { id: "15d", label: "Last 15 days", days: 15 },
  { id: "30d", label: "Last 30 days", days: 30 },
  { id: "60d", label: "Last 60 days", days: 60 },
];
const hostMetrics: ChartMetric[][] = [
  [{ key: "cpuPercent", label: "CPU usage", unit: "percent" }],
  [{ key: "memoryPercent", label: "Memory usage", unit: "percent" }],
  [{ key: "diskPercent", label: "Disk usage", unit: "percent" }],
  [
    { key: "networkRxBytesPerSecond", label: "Network received", unit: "rate" },
    { key: "networkTxBytesPerSecond", label: "Network sent", unit: "rate" },
  ],
  [
    { key: "diskReadBytesPerSecond", label: "Disk read", unit: "rate" },
    { key: "diskWriteBytesPerSecond", label: "Disk written", unit: "rate" },
  ],
  [{ key: "load1", label: "Load average (1 minute)", unit: "number" }],
];
const workloadMetrics: ChartMetric[][] = [
  [{ key: "cpuPercent", label: "CPU usage", unit: "percent" }],
  [{ key: "memoryUsedBytes", label: "Memory usage", unit: "bytes" }],
  [
    { key: "networkRxBytesPerSecond", label: "Network received", unit: "rate" },
    { key: "networkTxBytesPerSecond", label: "Network sent", unit: "rate" },
  ],
  [
    { key: "diskReadBytesPerSecond", label: "Block read", unit: "rate" },
    { key: "diskWriteBytesPerSecond", label: "Block written", unit: "rate" },
  ],
];

export function MonitoringHistory({
  path,
  serverId,
  workload = false,
}: {
  path: string;
  serverId?: string;
  workload?: boolean;
}) {
  const [range, setRange] = useState("1h");
  const [environment, setEnvironment] = useState("production");
  const [view, setView] = useState("average");
  const [instance, setInstance] = useState("all");
  const syncId = useId();
  const query = useApiQuery<History>(
    `${path}?range=${range}&environment=${environment}`,
    30_000,
    { keepPreviousData: true },
  );
  const history = useDeferredValue(query.data);
  const chartView = useDeferredValue(view);
  const chartInstance = useDeferredValue(instance);
  const updating =
    (!query.error && query.isPreviousData) ||
    history !== query.data ||
    chartView !== view ||
    chartInstance !== instance;
  const series = useMemo(
    () =>
      history?.series.filter(
        (row) => chartInstance === "all" || row.id === chartInstance,
      ) ?? [],
    [history, chartInstance],
  );
  if (!history)
    return (
      <Widget>
        <Widget.Header>
          <Widget.Title>Performance</Widget.Title>
        </Widget.Header>
        <Widget.Content className="min-h-64">
          {query.error ? (
            <QueryError message={query.error} />
          ) : (
            <QueryLoading />
          )}
        </Widget.Content>
      </Widget>
    );
  const hasPoints = history.series.some((row) => row.points.length > 0);
  const agent = history.agent;
  const selectedServer = serverId ?? history.serverId;
  return (
    <section className="grid min-w-0 gap-4" aria-label="Performance history">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="font-medium">Performance</h2>
          <MonitoringStatus agent={agent} />
          {updating ? (
            <span role="status" className="text-xs text-muted">
              Updating charts…
            </span>
          ) : null}
        </div>
        <div className="flex max-w-full flex-wrap items-center gap-2">
          {workload ? (
            <HistorySelect
              label="Environment"
              value={environment}
              onChange={(value) => {
                setEnvironment(value);
                setInstance("all");
              }}
              options={[
                { id: "production", label: "Production" },
                { id: "preview", label: "Previews" },
              ]}
            />
          ) : null}
          {workload && history.series.length > 1 ? (
            <HistorySelect
              label="Instance"
              value={instance}
              onChange={setInstance}
              options={[
                { id: "all", label: "All instances" },
                ...history.series.map((row) => ({
                  id: row.id,
                  label: `${row.previewId ? `Preview ${row.previewId.slice(0, 8)}` : "Container"} · ${row.id.slice(0, 8)}`,
                })),
              ]}
            />
          ) : null}
          <HistorySelect
            label="Aggregation"
            value={view}
            onChange={setView}
            options={[
              { id: "average", label: "Average" },
              { id: "peak", label: "Peak" },
            ]}
          />
          <HistorySelect
            label="Time range"
            value={range}
            onChange={(value) => {
              setRange(value);
              setInstance("all");
            }}
            options={ranges.filter((row) => row.days <= agent.retentionDays)}
          />
        </div>
      </div>
      {query.error ? <QueryError message={query.error} /> : null}
      {agent.desiredState !== "enabled" && hasPoints ? (
        <MonitoringEmptyState serverId={selectedServer} disabled historical />
      ) : null}
      {!hasPoints ? (
        <MonitoringEmptyState
          serverId={selectedServer}
          disabled={agent.desiredState !== "enabled"}
        />
      ) : (
        <>
          <div
            className="grid min-w-0 gap-4 xl:grid-cols-2"
            aria-busy={updating}
          >
            {(workload ? workloadMetrics : hostMetrics).map((metrics) => (
              <MonitoringChartSlot
                key={metrics[0]!.key}
                metrics={metrics}
                series={series}
                history={history}
                view={chartView}
                syncId={syncId}
              />
            ))}
          </div>
          {history.events.length ? (
            <p className="text-xs text-muted">
              Graph markers: D — deployment · R — container restart
            </p>
          ) : null}
          {history.seriesLimited ? (
            <p className="text-xs text-muted">
              Showing the 32 most recent instances. Choose a shorter range to
              inspect more detail.
            </p>
          ) : null}
          <MonitoringEvents events={history.events} />
        </>
      )}
    </section>
  );
}
function MonitoringEmptyState({
  serverId,
  disabled,
  historical = false,
}: {
  serverId: string;
  disabled: boolean;
  historical?: boolean;
}) {
  return (
    <Widget>
      <Widget.Content
        className={`grid place-content-center justify-items-center gap-3 text-center ${historical ? "" : "min-h-64"}`}
      >
        <h3 className="font-medium">
          {disabled
            ? "Advanced monitoring is not enabled"
            : "No measurements in this range"}
        </h3>
        <p className="max-w-lg text-sm text-muted">
          {disabled
            ? "Turn on advanced monitoring in this server's settings to see performance over time."
            : "Metrics appear after the agent reports. Try another time range or check the agent's connection."}
          {historical ? " Previously collected history is shown below." : ""}
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <ButtonLink
            href={`/servers/${serverId}?section=settings&settings=monitoring`}
            variant="secondary"
          >
            Server monitoring settings
          </ButtonLink>
          <MonitoringDocumentation />
        </div>
      </Widget.Content>
    </Widget>
  );
}
function HistorySelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ id: string; label: string }>;
}) {
  return (
    <Select
      selectedKey={value}
      onSelectionChange={(key) => {
        if (key) onChange(String(key));
      }}
      variant="secondary"
      className="min-w-32 max-w-64"
    >
      <Label className="sr-only">{label}</Label>
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {options.map((option) => (
            <ListBox.Item
              key={option.id}
              id={option.id}
              textValue={option.label}
            >
              {option.label}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}
