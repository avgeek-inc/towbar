"use client";

import { memo, useId } from "react";
import type { Server } from "@workspace/towbar-web-client";
import { TooltipText } from "@avgeek-oss/design-system/overlays/tooltip";
import { InlineLink } from "./page-parts";

type Summary = NonNullable<Server["scout"]>;

function Sparkline({
  summary,
  metric,
  label,
}: {
  summary: Summary;
  metric: "cpuPercent" | "memoryPercent";
  label: string;
}) {
  const fillId = useId();
  const start = Date.parse(summary.start),
    end = Date.parse(summary.end);
  const paths = { normal: "", high: "" };
  const areas = { normal: "", high: "" };
  type Point = { at: number; x: number; y: number; value: number };
  let previous: Point | null = null;
  const segment = (from: Point, to: Point, high: boolean) => {
    const tone = high ? "high" : "normal";
    paths[tone] +=
      `M${from.x.toFixed(2)},${from.y.toFixed(2)}L${to.x.toFixed(2)},${to.y.toFixed(2)} `;
    areas[tone] +=
      `M${from.x.toFixed(2)},20L${from.x.toFixed(2)},${from.y.toFixed(2)}L${to.x.toFixed(2)},${to.y.toFixed(2)}L${to.x.toFixed(2)},20Z `;
  };
  for (const point of summary.points) {
    const value = point[metric],
      at = Date.parse(point.at);
    if (value === null || !Number.isFinite(value)) {
      previous = null;
      continue;
    }
    const current = {
      at,
      value,
      x: 2 + ((at - start) / (end - start)) * 116,
      y: 20 - (Math.min(100, Math.max(0, value)) / 100) * 18,
    };
    if (!previous || at - previous.at > 45_000) {
      segment(current, { ...current, x: current.x + 0.01 }, value > 80);
    } else if (previous.value > 80 === value > 80) {
      segment(previous, current, value > 80);
    } else {
      const crossing = {
        ...current,
        value: 80,
        y: 5.6,
        x:
          previous.x +
          ((current.x - previous.x) * (80 - previous.value)) /
            (value - previous.value),
      };
      segment(previous, crossing, previous.value > 80);
      segment(crossing, current, value > 80);
    }
    previous = current;
  }
  const description = `${label} usage over the last 30 minutes`;

  return (
    <TooltipText tooltip={description} className="block w-fit" tabIndex={0}>
      <svg
        width="120"
        height="22"
        viewBox="0 0 120 22"
        role="img"
        aria-label={description}
        className="block shrink-0"
      >
        <defs>
          {(["normal", "high"] as const).map((tone) => (
            <linearGradient
              key={tone}
              id={`${fillId}-${tone}`}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop
                offset="0%"
                stopColor={tone === "high" ? "var(--danger)" : "var(--success)"}
                stopOpacity="0.3"
              />
              <stop
                offset="100%"
                stopColor={tone === "high" ? "var(--danger)" : "var(--success)"}
                stopOpacity="0.04"
              />
            </linearGradient>
          ))}
        </defs>
        <path d={areas.normal} fill={`url(#${fillId}-normal)`} />
        <path d={areas.high} fill={`url(#${fillId}-high)`} />
        <path d="M2,20 H118" stroke="var(--muted)" opacity="0.12" />
        <path
          d={paths.normal}
          fill="none"
          stroke="var(--success)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d={paths.high}
          fill="none"
          stroke="var(--danger)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </TooltipText>
  );
}

export const ScoutServerSummary = memo(function ScoutServerSummary({
  server,
}: {
  server: Server;
}) {
  const summary = server.scout;
  const online = summary?.enabled && summary.status === "online";
  const hasData =
    online &&
    summary.points.some(
      (point) => point.cpuPercent !== null || point.memoryPercent !== null,
    );
  return (
    <InlineLink
      href={`/servers/${server.id}/performance`}
      className="grid min-w-30 gap-0 no-underline"
      aria-label={`Scout Agent for ${server.canonicalIp}: ${online ? "CPU and memory over the last 30 minutes" : "Inactive"}`}
    >
      {hasData ? (
        <>
          <Sparkline summary={summary} metric="cpuPercent" label="CPU" />
          <Sparkline summary={summary} metric="memoryPercent" label="Memory" />
        </>
      ) : (
        <span className="text-xs text-muted">
          {online ? "No recent data" : "Inactive"}
        </span>
      )}
    </InlineLink>
  );
});
