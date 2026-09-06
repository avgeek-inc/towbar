"use client";

import { memo, useMemo, useState } from "react";
import type {
  MonitoringAggregates,
  MonitoringHistory as History,
  MonitoringSeries,
} from "@workspace/towbar-web-client";
import { LineChart } from "@workspace/web-design-system/charts/line-chart";
import { MonitoringMetricIcon } from "./monitoring-metric-icon";
import { Widget } from "@workspace/web-design-system/data-display/widget";
import { monitoringChartGaps } from "./monitoring-chart-gaps";
import {
  MonitoringEventMarker,
  monitoringEventColor,
} from "./monitoring-events";

const axisTick = { fill: "var(--muted)", fontSize: 11 };
const percentageDomain = [0, 100] as const;
const automaticDomain = [0, "auto"] as const;
const palette = [
  "var(--accent)",
  "#a67c00",
  "#16a34a",
  "#a855f7",
  "#e06c36",
  "#0d9488",
];
type MetricKey = keyof MonitoringAggregates;
export type ChartMetric = {
  key: MetricKey;
  label: string;
  unit: "percent" | "bytes" | "rate" | "number";
};
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
export type MetricChartProps = {
  metrics: ChartMetric[];
  series: MonitoringSeries[];
  history: History;
  view: string;
  syncId: string;
  onRangeSelect?: (start: number, end: number) => void;
};
export const MetricChart = memo(function MetricChart({
  metrics,
  series,
  history,
  view,
  syncId,
  onRangeSelect,
}: MetricChartProps) {
  const timeDomain = useMemo(
    () => [Date.parse(history.startAt), Date.parse(history.endAt)] as const,
    [history.startAt, history.endAt],
  );
  const [eventActive, setEventActive] = useState(false);
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
  const lines = useMemo(
    () =>
      series.flatMap((instance, index) =>
        metrics.map((metric, metricIndex) => ({
          key: `${index}-${metric.key}`,
          label: `${metric.label}${series.length > 1 ? ` · ${instance.id.slice(0, 8)}` : ""}`,
          color:
            palette[(index * metrics.length + metricIndex) % palette.length]!,
          unit: metric.unit,
        })),
      ),
    [series, metrics],
  );
  const gaps = useMemo(
    () =>
      lines.flatMap((line) =>
        monitoringChartGaps(data, line.key).map((segment) => ({
          line,
          segment,
        })),
      ),
    [data, lines],
  );
  const tickFormatter = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(
      undefined,
      Date.parse(history.endAt) - Date.parse(history.startAt) <= 86400_000
        ? { hour: "2-digit", minute: "2-digit" }
        : { month: "short", day: "numeric" },
    );
    return (value: number) => formatter.format(value);
  }, [history.startAt, history.endAt]);
  const yTickFormatter = useMemo(
    () => (value: number) => formatMetric(value, metrics[0]!.unit),
    [metrics],
  );
  const tooltipDateFormatter = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "long",
    });
    return (value: unknown) => formatter.format(Number(value));
  }, []);
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
        <Widget.Title icon={<MonitoringMetricIcon metric={metrics[0]!.key} />}>
          {title}
        </Widget.Title>
      </Widget.Header>
      <Widget.Content className="min-w-0">
        <LineChart
          data-range-chart={onRangeSelect ? "" : undefined}
          className={
            onRangeSelect
              ? "select-none touch-pan-y cursor-crosshair"
              : undefined
          }
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
            domain={timeDomain}
            allowDataOverflow
            tickFormatter={tickFormatter}
            minTickGap={45}
            tick={axisTick}
            tickMargin={8}
          />
          <LineChart.YAxis
            width="auto"
            tickMargin={4}
            tick={axisTick}
            tickFormatter={yTickFormatter}
            domain={
              metrics[0]!.unit === "percent"
                ? percentageDomain
                : automaticDomain
            }
          />
          {metrics[0]!.unit === "percent" ? (
            <LineChart.ReferenceLine
              y={80}
              className="monitoring-usage-threshold"
              aria-label="80% usage threshold"
              stroke="var(--danger)"
              strokeWidth={1.5}
              strokeDasharray="1 5"
              strokeLinecap="round"
              zIndex={400}
            />
          ) : null}
          {gaps.map(({ line, segment }) => (
            <LineChart.ReferenceLine
              key={`gap:${line.key}:${segment[0].x}`}
              className="monitoring-gap-connector"
              segment={segment}
              stroke={line.color}
              strokeWidth={1.8}
              strokeDasharray="2 4"
              strokeLinecap="round"
              strokeOpacity={0.65}
              zIndex={350}
            />
          ))}
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
              zIndex={600}
              stroke={monitoringEventColor(event.type)}
              strokeDasharray="4 4"
              strokeOpacity={0.6}
              label={
                <MonitoringEventMarker
                  event={event}
                  onActiveChange={setEventActive}
                />
              }
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
          {onRangeSelect ? (
            <LineChart.Selection domain={timeDomain} onSelect={onRangeSelect} />
          ) : null}
          <LineChart.Tooltip
            active={eventActive ? false : undefined}
            content={
              <LineChart.TooltipContent
                labelFormatter={tooltipDateFormatter}
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
});
