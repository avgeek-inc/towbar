import { z } from "zod";
import type {
  MonitoringAggregates,
  MonitoringMetricName,
} from "./monitoring.js";

export const deploymentComparisonQuerySchema = z
  .object({
    baselineId: z.string().uuid(),
    candidateId: z.string().uuid(),
    windowMinutes: z.coerce.number().int().min(5).max(1440).default(30),
    warmupMinutes: z.coerce.number().int().min(0).max(60).default(2),
    regressionPercent: z.coerce.number().min(1).max(500).default(20),
    minimumCoveragePercent: z.coerce.number().min(50).max(100).default(80),
  })
  .strict()
  .refine((value) => value.baselineId !== value.candidateId, {
    path: ["candidateId"],
    message: "Choose two different deployments",
  });
export type DeploymentComparisonQuery = z.infer<
  typeof deploymentComparisonQuerySchema
>;

export const comparisonMetrics: Array<{
  metric: MonitoringMetricName;
  label: string;
  unit: "cores" | "bytes" | "bytesPerSecond";
  regression: boolean;
  absoluteFloor: number;
}> = [
  {
    metric: "cpuCores",
    label: "CPU usage",
    unit: "cores",
    regression: true,
    absoluteFloor: 0.05,
  },
  {
    metric: "memoryUsedBytes",
    label: "Memory usage",
    unit: "bytes",
    regression: true,
    absoluteFloor: 16 * 1024 * 1024,
  },
  {
    metric: "networkRxBytesPerSecond",
    label: "Network received",
    unit: "bytesPerSecond",
    regression: false,
    absoluteFloor: 0,
  },
  {
    metric: "networkTxBytesPerSecond",
    label: "Network sent",
    unit: "bytesPerSecond",
    regression: false,
    absoluteFloor: 0,
  },
  {
    metric: "diskReadBytesPerSecond",
    label: "Block read",
    unit: "bytesPerSecond",
    regression: false,
    absoluteFloor: 0,
  },
  {
    metric: "diskWriteBytesPerSecond",
    label: "Block written",
    unit: "bytesPerSecond",
    regression: false,
    absoluteFloor: 0,
  },
];

export type ComparisonPoint = {
  offsetSeconds: number;
  metrics: MonitoringAggregates;
};
export type ComparisonMetricSummary = {
  average: number | null;
  peak: number | null;
  coveragePercent: number;
  samples: number;
};
export function summarizeComparisonMetric(
  points: ComparisonPoint[],
  metric: MonitoringMetricName,
  windowSeconds: number,
): ComparisonMetricSummary {
  let sum = 0,
    count = 0,
    peak: number | null = null;
  for (const point of points) {
    const value = point.metrics[metric];
    if (!value || value.count <= 0) continue;
    sum += value.sum;
    count += value.count;
    peak = Math.max(peak ?? value.max, value.max);
  }
  return {
    average: count ? sum / count : null,
    peak,
    samples: count,
    coveragePercent: Math.min(100, ((count * 30) / windowSeconds) * 100),
  };
}

export function compareMetricSummaries(
  baseline: ComparisonMetricSummary,
  candidate: ComparisonMetricSummary,
  input: {
    regressionPercent: number;
    minimumCoveragePercent: number;
    absoluteFloor: number;
    regression: boolean;
  },
) {
  const delta =
    baseline.average !== null && candidate.average !== null
      ? candidate.average - baseline.average
      : null;
  const deltaPercent =
    delta !== null && baseline.average !== null && baseline.average !== 0
      ? (delta / baseline.average) * 100
      : null;
  const enoughData =
    baseline.average !== null &&
    candidate.average !== null &&
    baseline.coveragePercent >= input.minimumCoveragePercent &&
    candidate.coveragePercent >= input.minimumCoveragePercent;
  const material =
    delta !== null &&
    Math.abs(delta) >= input.absoluteFloor &&
    (deltaPercent === null
      ? delta !== 0
      : Math.abs(deltaPercent) >= input.regressionPercent);
  return {
    baseline,
    candidate,
    delta,
    deltaPercent,
    assessment: !enoughData
      ? ("insufficient_data" as const)
      : !input.regression
        ? ("informational" as const)
        : !material
          ? ("stable" as const)
          : delta! > 0
            ? ("increased" as const)
            : ("decreased" as const),
  };
}
