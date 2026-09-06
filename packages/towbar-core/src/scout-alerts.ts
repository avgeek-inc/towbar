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

export const scoutAlertConditionSchema = z
  .object({
    metric: z.enum(scoutAlertMetrics),
    operator: z.enum(["above", "below"]).default("above"),
    threshold: z.number().finite().nonnegative().max(1e18),
    recoveryThreshold: z.number().finite().nonnegative().max(1e18),
    durationSeconds: z.number().int().min(0).max(3600).default(300),
    recoverySeconds: z.number().int().min(0).max(3600).default(120),
    windowSeconds: z.number().int().min(60).max(3600).default(300),
    aggregation: z.enum(["average", "peak"]).default("average"),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.operator === "above"
        ? value.recoveryThreshold > value.threshold
        : value.recoveryThreshold < value.threshold
    )
      ctx.addIssue({
        code: "custom",
        path: ["recoveryThreshold"],
        message: "Recovery must be on the healthy side of the alert threshold",
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
    destinationIds: z.array(z.string().uuid()).max(10).default([]),
    notifyRecovery: z.boolean().default(true),
    repeatSeconds: z
      .union([z.literal(0), z.number().int().min(900).max(86400)])
      .default(0),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.destinationIds).size !== value.destinationIds.length)
      ctx.addIssue({
        code: "custom",
        path: ["destinationIds"],
        message: "Select each destination once",
      });
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
    deployableId: z.string().uuid().optional(),
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
      recoveryThreshold: 85,
      durationSeconds: 300,
      recoverySeconds: 120,
      windowSeconds: 300,
      aggregation: "average",
    },
  },
  {
    id: "memory",
    name: "Sustained memory pressure",
    severity: "warning",
    condition: {
      metric: "memoryPercent",
      operator: "above",
      threshold: 90,
      recoveryThreshold: 85,
      durationSeconds: 300,
      recoverySeconds: 120,
      windowSeconds: 300,
      aggregation: "average",
    },
  },
  {
    id: "cpu",
    name: "Sustained CPU usage",
    severity: "warning",
    condition: {
      metric: "cpuPercent",
      operator: "above",
      threshold: 90,
      recoveryThreshold: 80,
      durationSeconds: 600,
      recoverySeconds: 120,
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
      recoveryThreshold: 0,
      durationSeconds: 0,
      recoverySeconds: 120,
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
      recoveryThreshold: 60,
      durationSeconds: 0,
      recoverySeconds: 60,
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

/** Evaluate fresh, continuous observations. Missing or delayed data cannot prove health. */
export function evaluateScoutCondition(
  condition: ScoutAlertCondition,
  observations: ScoutObservation[],
  now: number,
  active: boolean,
): ScoutConditionResult {
  const duration =
    (active ? condition.recoverySeconds : condition.durationSeconds) * 1000;
  const threshold = active ? condition.recoveryThreshold : condition.threshold;
  const points = [
    ...new Map(
      observations
        .filter((p) => p.at <= now && Number.isFinite(p.at))
        .map((p) => [p.at, p]),
    ).values(),
  ].sort((a, b) => a.at - b.at);
  const latest = points.at(-1);
  if (
    !latest ||
    latest.value === null ||
    !Number.isFinite(latest.value) ||
    now - latest.at > 90_000
  )
    return { state: "unknown", value: null, since: null };
  const matches = (value: number) =>
    active
      ? condition.operator === "above"
        ? value <= threshold
        : value >= threshold
      : condition.operator === "above"
        ? value >= threshold
        : value <= threshold;
  if (!matches(latest.value))
    return {
      state: active ? "firing" : "healthy",
      value: latest.value,
      since: latest.at,
    };
  let since = latest.at;
  for (let i = points.length - 2; i >= 0; i--) {
    const point = points[i]!;
    if (
      since - point.at > 90_000 ||
      point.value === null ||
      !Number.isFinite(point.value) ||
      !matches(point.value)
    )
      break;
    since = point.at;
    if (latest.at - since >= duration) break;
  }
  // Age of the newest sample is never added to a sustained condition.
  return {
    state:
      latest.at - since >= duration
        ? active
          ? "healthy"
          : "firing"
        : "pending",
    value: latest.value,
    since,
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
    values.set(sample.at, group);
  }
  return [...values]
    .map(([at, group]) => ({
      at,
      value: group.length
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
  const previous = new Map<string, { at: number; count: number }>();
  const deltas: Array<{ at: number; count: number }> = [];
  const observed = new Set<number>();
  for (const sample of ordered) {
    const metric = sample.metrics.restartCount;
    if (!metric || metric.count < 1) continue;
    const old = previous.get(sample.entityId);
    if (old && sample.at > old.at && sample.at - old.at <= 90_000) {
      observed.add(sample.at);
      if (metric.max > old.count)
        deltas.push({ at: sample.at, count: metric.max - old.count });
    }
    previous.set(sample.entityId, { at: sample.at, count: metric.max });
  }
  let start = 0,
    end = 0,
    total = 0;
  return [...observed]
    .sort((a, b) => a - b)
    .map((at) => {
      while (end < deltas.length && deltas[end]!.at <= at)
        total += deltas[end++]!.count;
      while (start < end && deltas[start]!.at <= at - windowSeconds * 1000)
        total -= deltas[start++]!.count;
      return { at, value: total };
    });
}
