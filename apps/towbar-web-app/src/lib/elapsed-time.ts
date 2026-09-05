const terminalStates = new Set([
  "succeeded",
  "succeeded_with_warnings",
  "skipped",
  "failed",
  "cancelled",
]);

export type TimedEvent = {
  startedAt: string | null;
  finishedAt: string | null;
  status: string;
};

export function isEventRunning(event: TimedEvent) {
  return (
    event.startedAt !== null &&
    Number.isFinite(Date.parse(event.startedAt)) &&
    !event.finishedAt &&
    !terminalStates.has(event.status) &&
    event.status !== "waiting" &&
    event.status !== "queued"
  );
}

export function formatElapsedTime(event: TimedEvent, now: number): string {
  if (!event.startedAt) return "—";
  const start = Date.parse(event.startedAt);
  // A terminal status without an end timestamp must never keep counting.
  const end = event.finishedAt
    ? Date.parse(event.finishedAt)
    : isEventRunning(event) && now > 0
      ? now
      : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "—";
  const seconds = Math.max(0, Math.floor((end - start) / 1_000));
  const parts: string[] = [];
  if (seconds >= 86_400) parts.push(`${Math.floor(seconds / 86_400)}d`);
  if (seconds >= 3_600) parts.push(`${Math.floor(seconds / 3_600) % 24}h`);
  if (seconds >= 60) parts.push(`${Math.floor(seconds / 60) % 60}m`);
  parts.push(`${seconds % 60}s`);
  return parts.join(" ");
}
