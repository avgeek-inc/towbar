"use client";

import { useId, useMemo, useState } from "react";
import type {
  MonitoringAggregates,
  MonitoringHistory as History,
  MonitoringSeries,
} from "@workspace/towbar-web-client";
import { LineChart } from "@workspace/web-design-system/charts/line-chart";
import { Widget } from "@workspace/web-design-system/data-display/widget";
import { Label } from "@workspace/web-design-system/forms/label";
import { ListBox, Select } from "@workspace/web-design-system/forms/select";
import { ButtonLink } from "@workspace/web-design-system/buttons/button";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import { useApiQuery } from "@/hooks/use-api-query";
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
const palette = [
  "var(--accent)",
  "#a67c00",
  "#16a34a",
  "#a855f7",
  "#e06c36",
  "#0d9488",
];
type MetricKey = keyof MonitoringAggregates;
type ChartMetric = {
  key: MetricKey;
  label: string;
  unit: "percent" | "bytes" | "rate" | "number";
};
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
  );
  const history = query.data;
  const series = useMemo(
    () =>
      history?.series.filter(
        (row) => instance === "all" || row.id === instance,
      ) ?? [],
    [history, instance],
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
      {!hasPoints ? (
        <Widget>
          <Widget.Content className="grid min-h-64 place-content-center justify-items-center gap-3 text-center">
            <h3 className="font-medium">
              {agent.status === "disabled"
                ? "Enable enhanced monitoring"
                : "No measurements in this range"}
            </h3>
            <p className="max-w-lg text-sm text-muted">
              {agent.status === "disabled"
                ? "Install the monitoring agent to see server, app, and resource performance over time."
                : "Metrics appear after the agent reports. Try another time range or check the agent's connection."}
            </p>
            <ButtonLink
              href={`/servers/${selectedServer}?section=settings&settings=monitoring`}
              variant="secondary"
            >
              Monitoring settings
            </ButtonLink>
          </Widget.Content>
        </Widget>
      ) : (
        <>
          <div className="grid min-w-0 gap-4 xl:grid-cols-2">
            {(workload ? workloadMetrics : hostMetrics).map((metrics) => (
              <MetricChart
                key={metrics[0]!.key}
                metrics={metrics}
                series={series}
                history={history}
                view={view}
                syncId={syncId}
              />
            ))}
          </div>
          <p className="text-xs text-muted">
            {history.stepSeconds < 60
              ? `${history.stepSeconds}-second`
              : `${history.stepSeconds / 60}-minute`}{" "}
            chart intervals · Gaps mean no measurement.{" "}
            {workload
              ? "Each line follows one container; replacements retain their history. "
              : ""}
            {history.seriesLimited
              ? "Showing the 32 most recent instances. Choose a shorter range to inspect more detail. "
              : ""}
            Retained for {agent.retentionDays} days.
          </p>
          {history.events.length ? (
            <details className="text-sm">
              <summary className="w-fit cursor-pointer text-muted">
                Deployment and restart events ({history.events.length})
              </summary>
              <ul className="mt-3 grid max-h-48 gap-2 overflow-y-auto">
                {history.events.map((event) => (
                  <li
                    key={`${event.type}:${event.id}:${event.at}`}
                    className="flex flex-wrap justify-between gap-2"
                  >
                    <span>
                      {event.type === "deployment"
                        ? `Deployment ${event.id.slice(0, 8)} · ${event.state}`
                        : "Container restarted"}
                    </span>
                    <time className="text-muted" dateTime={event.at}>
                      {new Date(event.at).toLocaleString()}
                    </time>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      )}
    </section>
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
export function formatMetric(value: number, unit: ChartMetric["unit"]) {
  if (unit === "percent") return `${value.toFixed(1)}%`;
  if (unit === "number") return value.toFixed(2);
  const scale =
    value >= 1024 ** 3
      ? 1024 ** 3
      : value >= 1024 ** 2
        ? 1024 ** 2
        : value >= 1024
          ? 1024
          : 1;
  const suffix =
    scale === 1024 ** 3
      ? "GiB"
      : scale === 1024 ** 2
        ? "MiB"
        : scale === 1024
          ? "KiB"
          : "B";
  return `${(value / scale).toFixed(scale === 1 ? 0 : 1)} ${suffix}${unit === "rate" ? "/s" : ""}`;
}
function MetricChart({
  metrics,
  series,
  history,
  view,
  syncId,
}: {
  metrics: ChartMetric[];
  series: MonitoringSeries[];
  history: History;
  view: string;
  syncId: string;
}) {
  const data = useMemo(() => {
    const start =
      Math.floor(
        new Date(history.startAt).getTime() / 1000 / history.stepSeconds,
      ) *
      history.stepSeconds *
      1000;
    const end = new Date(history.endAt).getTime();
    const rows = new Map<number, Record<string, number | null>>();
    for (let at = start; at < end; at += history.stepSeconds * 1000)
      rows.set(at, { at });
    for (const [index, instance] of series.entries())
      for (const point of instance.points) {
        const row = rows.get(new Date(point.at).getTime());
        if (!row) continue;
        for (const metric of metrics) {
          const value = point.metrics[metric.key];
          row[`${index}-${metric.key}`] = value
            ? view === "peak"
              ? value.max
              : value.sum / value.count
            : null;
        }
      }
    return [...rows.values()];
  }, [history, series, metrics, view]);
  const lines = series.flatMap((instance, index) =>
    metrics.map((metric, metricIndex) => ({
      key: `${index}-${metric.key}`,
      label: `${metric.label}${series.length > 1 ? ` · ${instance.id.slice(0, 8)}` : ""}`,
      color: palette[(index * metrics.length + metricIndex) % palette.length]!,
      unit: metric.unit,
    })),
  );
  const title =
    metrics.length > 1
      ? metrics[0]!.key.startsWith("network")
        ? "Network traffic"
        : "Disk I/O"
      : metrics[0]!.label;
  const summary =
    metrics.length === 1
      ? series.flatMap((row) =>
          row.points.flatMap((point) =>
            point.metrics[metrics[0]!.key]
              ? [point.metrics[metrics[0]!.key]!]
              : [],
          ),
        )
      : [];
  const sum = summary.reduce((value, point) => value + point.sum, 0),
    count = summary.reduce((value, point) => value + point.count, 0),
    peak = summary.reduce((value, point) => Math.max(value, point.max), 0);
  return (
    <Widget className="min-w-0">
      <Widget.Header
        endContent={
          count > 0 ? (
            <span className="text-xs tabular-nums text-muted">
              {series.length > 1 ? "Instance avg" : "Avg"}{" "}
              {formatMetric(sum / count, metrics[0]!.unit)} · Peak{" "}
              {formatMetric(peak, metrics[0]!.unit)}
            </span>
          ) : null
        }
      >
        <Widget.Title>{title}</Widget.Title>
      </Widget.Header>
      <Widget.Content className="min-w-0">
        <LineChart
          data={data}
          height={220}
          syncId={syncId}
          aria-label={`${title} over ${history.range}`}
        >
          <LineChart.Grid vertical={false} />
          <LineChart.XAxis
            dataKey="at"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(value) =>
              new Date(Number(value)).toLocaleString(
                undefined,
                history.range.endsWith("h")
                  ? { hour: "2-digit", minute: "2-digit" }
                  : { month: "short", day: "numeric" },
              )
            }
            minTickGap={45}
            tick={{ fill: "var(--muted)", fontSize: 11 }}
            tickMargin={8}
          />
          <LineChart.YAxis
            width={90}
            tick={{ fill: "var(--muted)", fontSize: 11 }}
            tickFormatter={(value) =>
              formatMetric(Number(value), metrics[0]!.unit)
            }
            domain={[0, metrics[0]!.unit === "percent" ? 100 : "auto"]}
          />
          {history.events.slice(0, 20).map((event) => (
            <LineChart.ReferenceLine
              key={`${event.type}:${event.id}:${event.at}`}
              x={
                Math.floor(
                  new Date(event.at).getTime() / 1000 / history.stepSeconds,
                ) *
                history.stepSeconds *
                1000
              }
              stroke="var(--muted)"
              strokeDasharray="2 5"
              strokeOpacity={0.35}
            />
          ))}
          {lines.map((line) => (
            <LineChart.Line
              key={line.key}
              dataKey={line.key}
              name={line.label}
              type="linear"
              stroke={line.color}
              strokeWidth={1.8}
              strokeDasharray={
                line.key.endsWith("TxBytesPerSecond") ? "5 3" : undefined
              }
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
          ))}
          <LineChart.Tooltip
            content={
              <LineChart.TooltipContent
                labelFormatter={(value) =>
                  new Date(Number(value)).toLocaleString()
                }
                valueFormatter={(value, key) =>
                  formatMetric(
                    Number(value),
                    lines.find((line) => line.key === key)?.unit ?? "number",
                  )
                }
              />
            }
          />
        </LineChart>
        {metrics.length > 1 ? (
          <Widget.Legend className="mt-2 flex-wrap">
            {metrics.map((metric, index) => (
              <Widget.LegendItem key={metric.key} color={palette[index]!}>
                {metric.label}
              </Widget.LegendItem>
            ))}
          </Widget.Legend>
        ) : null}
      </Widget.Content>
    </Widget>
  );
}
