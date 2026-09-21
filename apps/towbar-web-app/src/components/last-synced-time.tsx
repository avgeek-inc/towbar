"use client";

import { TooltipText } from "@workspace/web-design-system/overlays/tooltip";
import type { ReactNode } from "react";
import {
  TableCellDescription,
  tableCellStackClassName,
} from "@workspace/towbar-web-ui/table-cell-text";
import { useSyncExternalStore } from "react";
import { usePageVisibilityInterval } from "@workspace/web-design-system/hooks/use-page-visibility-interval";
import { formatTableTime } from "@/lib/table-time";
import {
  subscribeLocalization,
  localizationRevision,
  serverLocalizationRevision,
} from "@/lib/date-time-display";

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
  useSyncExternalStore(
    subscribeLocalization,
    localizationRevision,
    serverLocalizationRevision,
  );
  const now = useSyncExternalStore(
    subscribeToClock,
    getClockSnapshot,
    getServerClockSnapshot,
  );
  const formatted = formatTableTime(value, now);
  if (!formatted) return <span aria-label={`${label} unavailable`}>—</span>;

  return (
    <TooltipText
      as="time"
      tooltip={formatted.timezone}
      aria-label={`${label}: ${formatted.absolute} ${formatted.timezone}${formatted.relative ? `, ${formatted.relative}` : ""}`}
      className={`${tableCellStackClassName} whitespace-nowrap tabular-nums`}
      dateTime={value}
    >
      <span aria-hidden={!formatted.relative}>
        {formatted.relative ?? "\u00a0"}
      </span>
      <TableCellDescription>{formatted.absolute}</TableCellDescription>
    </TooltipText>
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
