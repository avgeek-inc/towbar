import { z } from "zod";
import {
  type MonitoringAggregates,
  monitoringMetricNames,
} from "./monitoring.js";

export const scoutAlertMetrics = [
  ...monitoringMetricNames.filter((name) => name !== "restartCount"),
  "restarts",
  "missingReports",
  "httpAvailability",
] as const;

export const scoutHttpCheckSchema = z
  .object({
    url: z
      .string()
      .trim()
      .url()
      .max(2048)
      .refine((value) => {
        let url: URL;
        try {
          url = new URL(value);
        } catch {
          return false;
        }
        return (
          ["http:", "https:"].includes(url.protocol) &&
          !url.username &&
          !url.password &&
          !url.hash &&
          (!url.port || url.port === "80" || url.port === "443")
        );
      }, "Use a public HTTP or HTTPS URL on port 80 or 443, without credentials or a fragment"),
    method: z.enum(["GET", "HEAD"]).default("GET"),
    intervalSeconds: z
      .number()
      .int()
      .min(30)
      .max(300)
      .multipleOf(30)
      .default(60),
    timeoutSeconds: z.number().int().min(1).max(10).default(5),
    expectedStatusMin: z.number().int().min(100).max(599).default(200),
    expectedStatusMax: z.number().int().min(100).max(599).default(299),
    maxRedirects: z.number().int().min(0).max(3).default(0),
  })
  .strict()
  .refine((value) => value.expectedStatusMin <= value.expectedStatusMax, {
    path: ["expectedStatusMax"],
    message: "Status range must be in increasing order",
  });
export type ScoutHttpCheck = z.infer<typeof scoutHttpCheckSchema>;

export const scoutAlertConditionSchema = z
  .object({
    metric: z.enum(scoutAlertMetrics),
    http: scoutHttpCheckSchema.optional(),
    operator: z.enum(["above", "below"]).default("above"),
    threshold: z.number().finite().nonnegative().max(1e18),
    windowSeconds: z.number().int().min(60).max(3600).default(300),
    aggregation: z.enum(["average", "peak"]).default("average"),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.metric === "httpAvailability" &&
      (!value.http || value.threshold !== 1)
    )
      ctx.addIssue({
        code: "custom",
        path: ["http"],
        message: "HTTP checks require a URL, a failure threshold of 1",
      });
    if (value.metric !== "httpAvailability" && value.http)
      ctx.addIssue({
        code: "custom",
        path: ["http"],
        message: "HTTP settings apply only to an HTTP check",
      });
    if (
      ["restarts", "missingReports", "httpAvailability"].includes(
        value.metric,
      ) &&
      value.operator !== "above"
    )
      ctx.addIssue({
        code: "custom",
        path: ["operator"],
        message: "This condition uses an above threshold",
      });
    if (
      value.metric === "missingReports" &&
      (value.threshold < 90 || value.threshold > 3600)
    )
      ctx.addIssue({
        code: "custom",
        path: ["threshold"],
        message:
          "Choose a missing-report interval between 90 seconds and one hour",
      });
    if (
      value.metric === "restarts" &&
      (!Number.isInteger(value.threshold) || value.threshold < 1)
    )
      ctx.addIssue({
        code: "custom",
        path: ["threshold"],
        message: "Choose at least one restart",
      });
  });
export type ScoutAlertCondition = z.infer<typeof scoutAlertConditionSchema>;

export const scoutAlertRuleSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    enabled: z.boolean().default(true),
    severity: z.enum(["warning", "critical"]).default("warning"),
    deployableId: z.string().uuid().nullable().default(null),
    environment: z.enum(["production", "preview"]).default("production"),
    condition: scoutAlertConditionSchema,
    notifyRecovery: z.boolean().default(true),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.deployableId &&
      [
        "missingReports",
        "diskPercent",
        "dockerDiskPercent",
        "httpAvailability",
      ].includes(value.condition.metric)
    )
      ctx.addIssue({
        code: "custom",
        path: ["condition", "metric"],
        message: "This condition belongs to a server",
      });
  });
export type ScoutAlertRuleInput = z.infer<typeof scoutAlertRuleSchema>;

export const scoutMuteSchema = z
  .object({
    durationSeconds: z.union([
      z.literal(0),
      z
        .number()
        .int()
        .min(60)
        .max(7 * 86400),
    ]),
    reason: z.string().trim().max(240).default(""),
  })
  .strict();
export const scoutIncidentQuerySchema = z
  .object({
    state: z.enum(["active", "resolved", "all"]).default("active"),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    before: z.string().datetime().optional(),
    beforeId: z.string().uuid().optional(),
    ruleId: z.string().uuid().optional(),
    deployableId: z.union([z.string().uuid(), z.literal("server")]).optional(),
  })
  .strict();

export const scoutAlertPresets: Array<{
  id: string;
  name: string;
  condition: ScoutAlertCondition;
  severity: "warning" | "critical";
}> = [
  {
    id: "disk",
    name: "Disk nearly full",
    severity: "critical",
    condition: {
      metric: "diskPercent",
      operator: "above",
      threshold: 90,
      windowSeconds: 300,
      aggregation: "average",
    },
  },
  {
    id: "memory",
    name: "High memory usage",
    severity: "warning",
    condition: {
      metric: "memoryPercent",
      operator: "above",
      threshold: 90,
      windowSeconds: 300,
      aggregation: "average",
    },
  },
  {
    id: "cpu",
    name: "High CPU usage",
    severity: "warning",
    condition: {
      metric: "cpuPercent",
      operator: "above",
      threshold: 90,
      windowSeconds: 300,
      aggregation: "average",
    },
  },
  {
    id: "restarts",
    name: "Container restart loop",
    severity: "critical",
    condition: {
      metric: "restarts",
      operator: "above",
      threshold: 3,
      windowSeconds: 300,
      aggregation: "peak",
    },
  },
  {
    id: "offline",
    name: "Scout stopped reporting",
    severity: "critical",
    condition: {
      metric: "missingReports",
      operator: "above",
      threshold: 180,
      windowSeconds: 300,
      aggregation: "peak",
    },
  },
];

export type ScoutObservation = { at: number; value: number | null };
export type ScoutConditionResult = {
  state: "firing" | "healthy" | "pending" | "unknown";
  value: number | null;
  since: number | null;
};

/** Evaluate the latest fresh reading. Missing data cannot trigger or prove recovery. */
export function evaluateScoutCondition(
  condition: ScoutAlertCondition,
  observations: ScoutObservation[],
  now: number,
): ScoutConditionResult {
  const latest = observations.reduce<ScoutObservation | undefined>(
    (last, point) =>
      Number.isFinite(point.at) &&
      point.at <= now &&
      (!last || point.at >= last.at)
        ? point
        : last,
    undefined,
  );
  const maxGapMs = condition.http
    ? (condition.http.intervalSeconds + 30) * 1000
    : 90_000;
  if (
    !latest ||
    latest.value === null ||
    !Number.isFinite(latest.value) ||
    now - latest.at > maxGapMs
  )
    return { state: "unknown", value: null, since: null };
  const firing =
    condition.operator === "above"
      ? latest.value >= condition.threshold
      : latest.value <= condition.threshold;
  return {
    state: firing ? "firing" : "healthy",
    value: latest.value,
    since: latest.at,
  };
}

export type ScoutSample = {
  entityId: string;
  at: number;
  metrics: MonitoringAggregates;
};

/** Worst per-instance gauge, never a sum of unrelated utilization percentages. */
export function scoutGaugeObservations(
  samples: ScoutSample[],
  condition: ScoutAlertCondition,
): ScoutObservation[] {
  const values = new Map<number, number[]>();
  const missing = new Set<number>();
  for (const sample of samples) {
    const metric =
      sample.metrics[condition.metric as keyof MonitoringAggregates];
    const group = values.get(sample.at) ?? [];
    if (metric && metric.count > 0)
      group.push(
        condition.aggregation === "peak"
          ? metric.max
          : metric.sum / metric.count,
      );
    else missing.add(sample.at);
    values.set(sample.at, group);
  }
  return [...values]
    .map(([at, group]) => ({
      at,
      value:
        group.length && !missing.has(at)
          ? condition.operator === "above"
            ? Math.max(...group)
            : Math.min(...group)
          : null,
    }))
    .sort((a, b) => a.at - b.at);
}

/** Counter resets/replacements are not restarts. Deltas need the same container identity. */
export function scoutRestartObservations(
  samples: ScoutSample[],
  windowSeconds: number,
): ScoutObservation[] {
  const ordered = [...samples].sort((a, b) => a.at - b.at);
  const previous = new Map<string, { at: number; count: number | null }>();
  const buckets = new Map<number, { count: number; complete: boolean }>();
  for (const sample of ordered) {
    const metric = sample.metrics.restartCount;
    const count = metric && metric.count > 0 ? metric.max : null;
    const old = previous.get(sample.entityId);
    const bucket = buckets.get(sample.at) ?? { count: 0, complete: true };
    if (
      count !== null &&
      old?.count !== null &&
      old?.count !== undefined &&
      sample.at > old.at &&
      sample.at - old.at <= 90_000
    )
      bucket.count += Math.max(0, count - old.count);
    else bucket.complete = false;
    buckets.set(sample.at, bucket);
    previous.set(sample.entityId, { at: sample.at, count });
  }
  const points = [...buckets];
  let start = 0,
    total = 0,
    incomplete = 0;
  return points.map(([at, bucket], end) => {
    total += bucket.count;
    incomplete += Number(!bucket.complete);
    while (start < end && points[start]![0] <= at - windowSeconds * 1000) {
      const old = points[start++]![1];
      total -= old.count;
      incomplete -= Number(!old.complete);
    }
    return {
      at,
      value:
        incomplete === 0 && (end - start + 1) * 30 >= windowSeconds
          ? total
          : null,
    };
  });
}
