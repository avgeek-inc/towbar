"use client";

import type { ReactNode } from "react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePageVisibilityInterval } from "@workspace/web-design-system/hooks/use-page-visibility-interval";
import { Tooltip } from "@workspace/web-design-system/overlays/tooltip";

import { formatDate } from "./dashboard-overview";

const minuteMs = 60_000;
const hourMs = 60 * minuteMs;
const dayMs = 24 * hourMs;
const listeners = new Set<() => void>();
let currentTime = Date.now();

export function RelativeTimeProvider({ children }: { children: ReactNode }) {
  usePageVisibilityInterval(updateClock, 30_000, {
    runImmediately: true,
    runOnVisible: true,
  });
  return children;
}

export function RelativeTime({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  const [isTooltipOpen, setIsTooltipOpen] = useState(false);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const now = useSyncExternalStore(
    subscribeToClock,
    getClockSnapshot,
    getServerClockSnapshot,
  );
  const absolute = formatDate(value);
  const relative = now ? formatRecentTime(value, now) : undefined;

  useEffect(
    () => () => {
      if (openTimer.current !== null) clearTimeout(openTimer.current);
    },
    [],
  );

  function openTooltipAfterDelay() {
    if (openTimer.current !== null) clearTimeout(openTimer.current);
    openTimer.current = setTimeout(() => {
      openTimer.current = null;
      setIsTooltipOpen(true);
    }, 200);
  }

  function closeTooltip() {
    if (openTimer.current !== null) clearTimeout(openTimer.current);
    openTimer.current = null;
    setIsTooltipOpen(false);
  }

  if (!relative) return <time dateTime={value}>{absolute}</time>;

  return (
    <Tooltip
      isOpen={isTooltipOpen}
      onOpenChange={(isOpen) => {
        if (!isOpen) closeTooltip();
      }}
    >
      <Tooltip.Trigger>
        <time
          aria-label={`${label} ${relative}. Exact time: ${absolute}`}
          className="decoration-muted cursor-help underline decoration-dashed underline-offset-4"
          dateTime={value}
          onBlur={closeTooltip}
          onFocus={() => setIsTooltipOpen(true)}
          onPointerEnter={openTooltipAfterDelay}
          onPointerLeave={closeTooltip}
          tabIndex={0}
        >
          {relative}
        </time>
      </Tooltip.Trigger>
      <Tooltip.Content placement="top" showArrow>
        <Tooltip.Arrow />
        {absolute}
      </Tooltip.Content>
    </Tooltip>
  );
}

export function LastSyncedTime({ value }: { value: string }) {
  return <RelativeTime label="Last synced" value={value} />;
}

function formatRecentTime(value: string, now: number) {
  const elapsed = now - new Date(value).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= dayMs)
    return undefined;
  if (elapsed < minuteMs) return "a few seconds ago";

  const totalMinutes = Math.floor(elapsed / minuteMs);
  if (elapsed < hourMs)
    return `${totalMinutes} ${totalMinutes === 1 ? "minute" : "minutes"} ago`;

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const hourLabel = `${hours} ${hours === 1 ? "hour" : "hours"}`;
  if (minutes === 0) return `${hourLabel} ago`;
  return `${hourLabel} ${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
}

function subscribeToClock(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function updateClock() {
  currentTime = Date.now();
  for (const notify of listeners) notify();
}

function getClockSnapshot() {
  return currentTime;
}

function getServerClockSnapshot() {
  return 0;
}
