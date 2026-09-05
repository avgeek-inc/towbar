"use client";

import type { ReactNode } from "react";
import { useSyncExternalStore } from "react";
import { usePageVisibilityInterval } from "@workspace/web-design-system/hooks/use-page-visibility-interval";
import { formatTableTime } from "@/lib/table-time";

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
  const now = useSyncExternalStore(
    subscribeToClock,
    getClockSnapshot,
    getServerClockSnapshot,
  );
  const formatted = formatTableTime(value, now);
  if (!formatted) return <span aria-label={`${label} unavailable`}>—</span>;

  return (
    <time
      aria-label={`${label}: ${formatted.absolute}${formatted.relative ? `, ${formatted.relative}` : ""}`}
      className="grid gap-0.5 whitespace-nowrap tabular-nums"
      dateTime={value}
    >
      <span>{formatted.absolute}</span>
      <span
        className="text-xs font-normal text-muted"
        aria-hidden={!formatted.relative}
      >
        {formatted.relative ?? "\u00a0"}
      </span>
    </time>
  );
}

export function LastSyncedTime({ value }: { value: string }) {
  return <RelativeTime label="Last synced" value={value} />;
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
