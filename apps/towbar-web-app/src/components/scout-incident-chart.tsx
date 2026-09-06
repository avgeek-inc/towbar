"use client";
import { memo, useMemo } from "react";
import { LineChart } from "@workspace/web-design-system/charts/line-chart";
import { metricDefinition, scoutValue } from "./scout-controls";
import { monitoringChartGaps } from "./monitoring-chart-gaps";
import type { IncidentDetails } from "./scout-incident-drawer";

export const ScoutIncidentChart = memo(function ScoutIncidentChart({
  incident,
  history,
}: Pick<IncidentDetails, "incident" | "history">) {
  const metric = metricDefinition(incident.condition.metric);
  const data = useMemo(
    () =>
      history.points.map((point) => ({
        at: new Date(point.at).getTime(),
        value: point.value === null ? null : point.value / metric.factor,
      })),
    [history.points, metric.factor],
  );
  const gaps = useMemo(() => monitoringChartGaps(data, "value"), [data]);
  const http = metric.id === "httpAvailability";
  const threshold = incident.condition.threshold / metric.factor;
  const start = new Date(history.startAt).getTime(),
    end = new Date(history.endAt).getTime();
  const format = (value: number) =>
    scoutValue(value * metric.factor, metric.id);
  return (
    <>
      <div className="rounded-xl bg-default p-3 sm:p-4">
        <div className="mb-4 text-sm font-medium">{metric.label}</div>
        {data.some((point) => point.value !== null) ? (
          <LineChart data={data} height={280}>
            <LineChart.Grid vertical={false} />
            <LineChart.XAxis
              dataKey="at"
              type="number"
              domain={[start, Math.max(start + 1000, end)]}
              tickCount={4}
              tick={{ fontSize: 11 }}
              tickFormatter={(at: number) =>
                new Date(at).toLocaleString(
                  undefined,
                  end - start > 86400_000
                    ? { month: "short", day: "numeric" }
                    : { hour: "2-digit", minute: "2-digit" },
                )
              }
              minTickGap={25}
            />
            <LineChart.YAxis
              width={http ? 88 : 65}
              tick={{ fontSize: 11 }}
              domain={
                http
                  ? [0, 1]
                  : metric.unit === "%"
                    ? [0, (maximum: number) => Math.max(100, maximum)]
                    : [0, "auto"]
              }
              ticks={http ? [0, 1] : undefined}
              tickFormatter={format}
            />
            <LineChart.Tooltip
              content={
                <LineChart.TooltipContent
                  labelFormatter={(at) =>
                    new Date(Number(at)).toLocaleString(undefined, {
                      dateStyle: "medium",
                      timeStyle: "long",
                    })
                  }
                  valueFormatter={(value) => format(Number(value))}
                />
              }
            />
            {gaps.map((segment, index) => (
              <LineChart.ReferenceLine
                key={index}
                segment={segment}
                stroke="var(--accent)"
                strokeDasharray="2 5"
                strokeOpacity={0.6}
                strokeWidth={2}
              />
            ))}
            <LineChart.Line
              dataKey="value"
              name={metric.label}
              stroke="var(--accent)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
              type="stepAfter"
              connectNulls={false}
            />
            {!http ? (
              <LineChart.ReferenceLine
                y={threshold}
                stroke="var(--danger)"
                strokeDasharray="2 4"
                ifOverflow="extendDomain"
                label={{
                  value: `Threshold ${format(threshold)}`,
                  position: "insideTopRight",
                  fill: "var(--danger)",
                  fontSize: 11,
                }}
              />
            ) : null}
            {incident.resolvedAt &&
            new Date(incident.resolvedAt).getTime() >= start ? (
              <LineChart.ReferenceLine
                x={new Date(incident.resolvedAt).getTime()}
                stroke="var(--success)"
                strokeDasharray="3 4"
                label={{
                  value:
                    incident.resolutionReason === "recovered"
                      ? "Recovered"
                      : "Closed",
                  position: "insideTopLeft",
                  fill: "var(--success)",
                  fontSize: 11,
                }}
              />
            ) : null}
          </LineChart>
        ) : (
          <div className="flex min-h-64 items-center justify-center text-sm text-muted">
            No retained measurements for this incident.
          </div>
        )}
      </div>
      <p className="text-xs text-muted">
        {http
          ? "Availability checks"
          : metric.id === "missingReports"
            ? "Estimated report age"
            : `${history.aggregation === "maximum" ? "Highest" : "Lowest"} reading per interval`}{" "}
        · Dotted bridges mark missing measurements.
      </p>
      {history.notes.map((note) => (
        <p key={note} className="text-xs text-muted">
          {note}
        </p>
      ))}
    </>
  );
});
