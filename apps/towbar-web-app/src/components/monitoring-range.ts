export type CustomMonitoringRange = { startAt: string; endAt: string };
export const monitoringRanges = [
  { id: "15m", label: "Last 15 minutes", days: 1 },
  { id: "30m", label: "Last 30 minutes", days: 1 },
  { id: "1h", label: "Last hour", days: 1 },
  { id: "6h", label: "Last 6 hours", days: 1 },
  { id: "24h", label: "Last 24 hours", days: 1 },
  { id: "7d", label: "Last 7 days", days: 7 },
  { id: "15d", label: "Last 15 days", days: 15 },
  { id: "30d", label: "Last 30 days", days: 30 },
  { id: "60d", label: "Last 60 days", days: 60 },
  { id: "custom", label: "Custom range", days: 0 },
];
export function localDateTime(value: string | number) {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 19);
}
export function parseCustomRange(
  start: string,
  end: string,
  retentionDays: number,
  now = Date.now(),
): CustomMonitoringRange {
  const from = new Date(start).getTime(),
    to = new Date(end).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to))
    throw new Error("Choose a start and end date/time.");
  if (to - from < 30000)
    throw new Error(
      "Choose a range of at least 30 seconds, with the end after the start.",
    );
  if (to > now) throw new Error("The end date/time cannot be in the future.");
  if (from < now - retentionDays * 86400000)
    throw new Error(
      `Choose a start within the retained ${retentionDays} days.`,
    );
  return {
    startAt: new Date(from).toISOString(),
    endAt: new Date(to).toISOString(),
  };
}
