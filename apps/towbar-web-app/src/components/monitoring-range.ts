export type CustomMonitoringRange = { startAt: string; endAt: string };
export const monitoringRanges = [
  { id: "15m", label: "Last 15 min", days: 1 },
  { id: "30m", label: "Last 30 min", days: 1 },
  { id: "1h", label: "Last hour", days: 1 },
  { id: "6h", label: "Last 6 hours", days: 1 },
  { id: "24h", label: "Last 24 hours", days: 1 },
  { id: "7d", label: "Last 7 days", days: 7 },
  { id: "15d", label: "Last 15 days", days: 15 },
  { id: "30d", label: "Last 30 days", days: 30 },
  { id: "60d", label: "Last 60 days", days: 60 },
  { id: "custom", label: "Custom range", days: 0 },
];
