"use client";

import { memo } from "react";
import type { Server } from "@workspace/towbar-web-client";
import { InlineLink } from "./page-parts";

type Summary = NonNullable<Server["scout"]>;

function Sparkline({
  summary,
  metric,
  label,
  color,
}: {
  summary: Summary;
  metric: "cpuPercent" | "memoryPercent";
  label: string;
  color: string;
}) {
  const start = Date.parse(summary.start),
    end = Date.parse(summary.end);
  let previous = 0;
  const path = summary.points
    .map((point) => {
      const value = point[metric],
        at = Date.parse(point.at);
      if (value === null || !Number.isFinite(value)) {
        previous = 0;
        return "";
      }
      const command = previous && at - previous <= 45_000 ? "L" : "M";
      previous = at;
      return `${command}${(2 + ((at - start) / (end - start)) * 88).toFixed(1)},${(20 - (Math.min(100, Math.max(0, value)) / 100) * 18).toFixed(1)}${command === "M" ? "l0.01,0" : ""}`;
    })
    .join(" ");
  const last = summary.points.at(-1)?.[metric];
  return (
    <span className="flex items-center gap-2">
      <span className="w-10 text-xs text-muted">{label}</span>
      <svg
        width="92"
        height="22"
        viewBox="0 0 92 22"
        role="img"
        aria-label={`${label} usage over the last 30 minutes`}
        className="shrink-0"
        style={{ color }}
      >
        <path d="M2,20 H90" stroke="currentColor" opacity="0.12" />
        <path
          d={path}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="w-11 text-right text-xs tabular-nums">
        {last == null ? "—" : `${last.toFixed(1)}%`}
      </span>
    </span>
  );
}

export const ScoutServerSummary = memo(function ScoutServerSummary({
  server,
}: {
  server: Server;
}) {
  const summary = server.scout;
  const enabled = summary?.enabled;
  const hasData =
    enabled &&
    summary.points.some(
      (point) => point.cpuPercent !== null || point.memoryPercent !== null,
    );
  const status = summary?.status ?? "disabled";
  const label =
    status === "disabled"
      ? "Not enabled"
      : status === "waiting"
        ? "Waiting for data"
        : status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <InlineLink
      href={`/servers/${server.id}?section=monitoring`}
      className="block min-w-52 no-underline"
      aria-label={`Scout Agent for ${server.canonicalIp}: ${label}`}
    >
      {hasData ? (
        <>
          <Sparkline
            summary={summary}
            metric="cpuPercent"
            label="CPU"
            color="var(--accent)"
          />
          <Sparkline
            summary={summary}
            metric="memoryPercent"
            label="Memory"
            color="#a67c00"
          />
        </>
      ) : null}
      <span className="flex items-center gap-1.5 text-xs text-muted">
        <span
          aria-hidden="true"
          className={`size-1.5 rounded-full ${status === "online" ? "bg-success" : status === "offline" || status === "failed" ? "bg-warning" : "bg-muted"}`}
        />
        {label}
        {hasData
          ? " · 30 min"
          : enabled && status === "online"
            ? " · No recent data"
            : ""}
      </span>
    </InlineLink>
  );
});
