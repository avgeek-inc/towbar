export type EmailDetail = { label: string; value: string; href?: string };
type Details = Record<string, string | number | boolean | null | undefined>;

const metricLabels: Record<string, string> = {
  cpuPercent: "CPU usage",
  cpuCores: "CPU cores used",
  cpuLimitCores: "CPU core limit",
  memoryPercent: "Memory usage",
  memoryUsedBytes: "Memory usage",
  memoryTotalBytes: "Total memory",
  memoryLimitBytes: "Memory limit",
  swapTotalBytes: "Total swap",
  diskUsedBytes: "Disk usage",
  diskTotalBytes: "Total disk space",
  dockerDiskUsedBytes: "Docker disk usage",
  dockerDiskTotalBytes: "Total Docker disk space",
  diskReadBytesPerSecond: "Disk read rate",
  diskWriteBytesPerSecond: "Disk write rate",
  networkRxBytesPerSecond: "Network received",
  networkTxBytesPerSecond: "Network sent",
  uptimeSeconds: "Uptime",
  diskPercent: "Disk usage",
  dockerDiskPercent: "Docker disk usage",
  swapUsedBytes: "Swap usage",
  load1: "Load average (1 minute)",
  load5: "Load average (5 minutes)",
  load15: "Load average (15 minutes)",
  restarts: "Container restarts",
  missingReports: "Time since last report",
  httpRequests: "HTTP requests",
  pageviews: "Pageviews",
  httpAvailability: "HTTP availability",
};

function readableLabel(key: string) {
  const words = key
    .replace(/([a-z\d])([A-Z])/gu, "$1 $2")
    .replaceAll("_", " ")
    .replace(/\bId\b/gu, "ID")
    .replace(/\b[A-Z][a-z]+/gu, (word) => word.toLowerCase());
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function measurement(value: number, metric: string) {
  const number = (input: number) =>
    input.toLocaleString("en-US", { maximumFractionDigits: 1 });
  if (metric.endsWith("Percent")) return `${number(value)}%`;
  if (metric.endsWith("Bytes") || metric.endsWith("BytesPerSecond")) {
    const units = ["B", "KiB", "MiB", "GiB", "TiB"];
    const exponent = Math.min(
      units.length - 1,
      Math.max(0, Math.floor(Math.log(Math.max(1, value)) / Math.log(1024))),
    );
    return `${number(value / 1024 ** exponent)} ${units[exponent]}${metric.endsWith("PerSecond") ? "/s" : ""}`;
  }
  if (metric === "missingReports" || metric === "uptimeSeconds")
    return `${number(value)} seconds`;
  if (metric === "httpAvailability") return value ? "Unavailable" : "Available";
  return number(value);
}

export function operationalDetails(details: Details): EmailDetail[] {
  const metric = typeof details.metric === "string" ? details.metric : "";
  return Object.entries(details).flatMap(([key, value]) => {
    if (value === null || value === undefined || value === "") return [];
    if (
      key === "metric" &&
      metricLabels[metric] &&
      typeof details.value === "number"
    )
      return [];
    const label =
      key === "value" && metricLabels[metric]
        ? metricLabels[metric]!
        : readableLabel(key);
    if (typeof value === "number")
      return [
        {
          label,
          value: measurement(
            value,
            key === "value" || key === "threshold" ? metric : "",
          ),
        },
      ];
    if (typeof value === "boolean")
      return [{ label, value: value ? "Yes" : "No" }];
    if (["performance", "configuration"].includes(key) && URL.canParse(value)) {
      const url = new URL(value);
      if (["https:", "http:"].includes(url.protocol))
        return [
          {
            label,
            value: key === "performance" ? "View performance" : "View settings",
            href: url.href,
          },
        ];
    }
    if (key === "metric")
      return [{ label, value: metricLabels[value] ?? readableLabel(value) }];
    if (key === "deployableKind")
      return [
        {
          label: "Deployable type",
          value:
            value === "app"
              ? "Service"
              : value === "resource"
                ? "Datastore"
                : readableLabel(value),
        },
      ];
    if (
      ["severity", "environment", "state", "status"].includes(key.toLowerCase())
    )
      return [{ label, value: readableLabel(value) }];
    return [{ label, value }];
  });
}

export function compactDetail(detail: EmailDetail) {
  const limit = /\bID$/u.test(detail.label) ? 9 : 64;
  const characters = Array.from(detail.value);
  return characters.length > limit
    ? `${characters.slice(0, limit - 1).join("")}…`
    : detail.value;
}
