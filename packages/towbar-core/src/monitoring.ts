import { z } from "zod";

export const monitoringRetentionDays = [7, 15, 30, 60] as const;
export const monitoringMetricNames = [
  "cpuPercent",
  "cpuCores",
  "cpuLimitCores",
  "memoryUsedBytes",
  "memoryTotalBytes",
  "memoryLimitBytes",
  "memoryPercent",
  "swapUsedBytes",
  "swapTotalBytes",
  "diskTotalBytes",
  "diskUsedBytes",
  "diskPercent",
  "dockerDiskTotalBytes",
  "dockerDiskUsedBytes",
  "dockerDiskPercent",
  "diskReadBytesPerSecond",
  "diskWriteBytesPerSecond",
  "networkRxBytesPerSecond",
  "networkTxBytesPerSecond",
  "uptimeSeconds",
  "load1",
  "load5",
  "load15",
  "restartCount",
] as const;
export type MonitoringMetricName = (typeof monitoringMetricNames)[number];
export type MonitoringValues = Partial<Record<MonitoringMetricName, number>>;
export type MonitoringAggregate = {
  sum: number;
  min: number;
  max: number;
  count: number;
};
export type MonitoringAggregates = Partial<
  Record<MonitoringMetricName, MonitoringAggregate>
>;
export const monitoringValuesSchema = z.partialRecord(
  z.enum(monitoringMetricNames),
  z.number().finite().nonnegative().max(1e18),
);
export const monitoringEntitySchema = z
  .object({
    id: z.union([z.literal("host"), z.string().regex(/^[a-f0-9]{64}$/u)]),
    deployableId: z.string().uuid().optional(),
    deploymentId: z.string().uuid().optional(),
    previewId: z.string().uuid().optional(),
    containerId: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .optional(),
    state: z
      .enum([
        "running",
        "exited",
        "created",
        "paused",
        "restarting",
        "removing",
        "dead",
      ])
      .optional(),
    health: z.enum(["", "healthy", "unhealthy", "starting", "none"]).optional(),
    metrics: monitoringValuesSchema,
  })
  .strict();
export const monitoringSampleSchema = z
  .object({
    id: z.string().regex(/^[a-f0-9]{32}$/u),
    collectedAt: z.string().datetime(),
    version: z.string().min(1).max(64),
    collectionDurationMs: z.number().int().nonnegative().max(120_000),
    collectionErrors: z.number().int().nonnegative().max(10_000),
    droppedSamples: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    entities: z.array(monitoringEntitySchema).min(1).max(513),
  })
  .strict()
  .superRefine((sample, context) => {
    if (
      sample.entities.filter((entity) => entity.id === "host").length !== 1 ||
      new Set(sample.entities.map((entity) => entity.id)).size !==
        sample.entities.length
    ) {
      context.addIssue({
        code: "custom",
        message: "One host and unique container identities are required",
      });
    }
    for (const entity of sample.entities) {
      if (
        entity.id !== "host" &&
        (!entity.deployableId || entity.containerId !== entity.id)
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Container metrics require workload and container identities",
        });
      }
      if (
        entity.id === "host" &&
        (entity.deployableId ||
          entity.deploymentId ||
          entity.containerId ||
          entity.previewId)
      ) {
        context.addIssue({
          code: "custom",
          message: "Host metrics cannot claim a workload identity",
        });
      }
    }
  });
export type MonitoringSample = z.infer<typeof monitoringSampleSchema>;
export const monitoringSettingsSchema = z
  .object({
    retentionDays: z.union([
      z.literal(7),
      z.literal(15),
      z.literal(30),
      z.literal(60),
    ]),
  })
  .strict();
export const monitoringInstallSchema = monitoringSettingsSchema.extend({
  acknowledge: z.literal(true),
});
export const monitoringRangeSeconds = {
  "15m": 900,
  "30m": 1800,
  "1h": 3600,
  "6h": 21600,
  "24h": 86400,
  "7d": 604800,
  "15d": 1296000,
  "30d": 2592000,
  "60d": 5184000,
} as const;
export const monitoringQuerySchema = z
  .object({
    range: z
      .enum([
        "15m",
        "30m",
        "1h",
        "6h",
        "24h",
        "7d",
        "15d",
        "30d",
        "60d",
        "custom",
      ])
      .default("1h"),
    startAt: z
      .string()
      .datetime({ offset: true })
      .optional()
      .describe(
        "Inclusive ISO 8601 start with time-zone offset; required for range=custom and within server retention.",
      ),
    endAt: z
      .string()
      .datetime({ offset: true })
      .optional()
      .describe(
        "Exclusive ISO 8601 end with time-zone offset; required for range=custom, at least 30 seconds after start and not in the future.",
      ),
    environment: z.enum(["production", "preview"]).default("production"),
    previewId: z.string().uuid().optional(),
  })
  .strict();
export type MonitoringQuery = z.infer<typeof monitoringQuerySchema>;

/** Resolve a bounded query window once for samples and events alike. */
export function resolveMonitoringWindow(
  input: Pick<MonitoringQuery, "range" | "startAt" | "endAt">,
  retentionDays: number,
  now = new Date(),
) {
  const current = now.getTime();
  let start: number, end: number;
  if (input.range === "custom") {
    start = Date.parse(input.startAt ?? "");
    end = Date.parse(input.endAt ?? "");
    if (!Number.isFinite(start) || !Number.isFinite(end))
      throw new Error("Choose both a valid start and end date/time.");
    if (end - start < 30_000)
      throw new Error(
        "Choose a range of at least 30 seconds, with the end after the start.",
      );
    if (end > current)
      throw new Error("The end date/time cannot be in the future.");
    if (start < current - retentionDays * 86400_000)
      throw new Error(
        `Choose a start within the retained ${retentionDays} days.`,
      );
  } else {
    if (input.startAt || input.endAt)
      throw new Error("Start and end date/time require a custom range.");
    end = current;
    start =
      current -
      Math.min(monitoringRangeSeconds[input.range], retentionDays * 86400) *
        1000;
  }
  const seconds = (end - start) / 1000;
  const step = Math.max(
    seconds > 86400 || start < current - 86400_000 ? 60 : 30,
    Math.ceil(seconds / 360 / 30) * 30,
  );
  if (input.range !== "custom")
    end = Math.floor(end / step / 1000) * step * 1000 + step * 1000;
  return { start: new Date(start), end: new Date(end), step };
}

export function aggregateMonitoringValues(
  values: MonitoringValues,
): MonitoringAggregates {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      { sum: value, min: value, max: value, count: 1 },
    ]),
  );
}

export type MonitoringAgentStatus = {
  status: string;
  desiredState: string;
  retentionDays: number;
  version: string | null;
  lastReportAt: string | null;
  lastCollectedAt: string | null;
  diagnostics: {
    collectionDurationMs: number;
    collectionErrors: number;
    droppedSamples: number;
  } | null;
  errorMessage: string | null;
  sampleIntervalSeconds: number;
  removingServer: boolean;
};
export type MonitoringPoint = { at: string; metrics: MonitoringAggregates };
export type MonitoringSeries = {
  id: string;
  deploymentId: string | null;
  previewId: string | null;
  points: MonitoringPoint[];
};
export type MonitoringHistory = {
  agent: MonitoringAgentStatus;
  serverId: string;
  range: string;
  startAt: string;
  endAt: string;
  stepSeconds: number;
  series: MonitoringSeries[];
  seriesLimited: boolean;
  eventsLimited: boolean;
  events: Array<{
    id: string;
    at: string;
    state: string;
    type: "deployment" | "restart";
  }>;
};

/** Compact host CPU and memory averages for the last 30 minutes. */
export type ServerMonitoringSummary = {
  enabled: boolean;
  status: string;
  lastCollectedAt: string | null;
  start: string;
  end: string;
  points: Array<{
    at: string;
    cpuPercent: number | null;
    memoryPercent: number | null;
  }>;
};
