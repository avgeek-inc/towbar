"use client";

import { memo } from "react";
import type { Server } from "@workspace/towbar-web-client";
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
  const start = Date.parse(summary.start),
    end = Date.parse(summary.end);
  const paths = { normal: "", high: "" };
  type Point = { at: number; x: number; y: number; value: number };
  let previous: Point | null = null;
  const segment = (from: Point, to: Point, high: boolean) => {
    paths[high ? "high" : "normal"] +=
      `M${from.x.toFixed(2)},${from.y.toFixed(2)}L${to.x.toFixed(2)},${to.y.toFixed(2)} `;
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
    <svg
      width="120"
      height="22"
      viewBox="0 0 120 22"
      role="img"
      aria-label={description}
      className="block shrink-0"
    >
      <title>{description}</title>
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
      href={`/servers/${server.id}?section=monitoring`}
      className="block min-w-30 no-underline"
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
