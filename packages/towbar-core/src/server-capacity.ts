import type {
  RuntimeHealthState,
  RuntimeObservedState,
} from "./resource-operations.js";
import type { SystemHealthStatus } from "./system-health.js";

export type RuntimeCapacity = {
  checkedAt: string | null;
  cpu: {
    logicalCount: number;
    loadAverage1m: number;
    usagePercent: number;
  } | null;
  disk: {
    availableBytes: number;
    totalBytes: number;
    usedPercent: number;
  } | null;
  id: string;
  ip: string;
  latestCheckStatus: "queued" | "running" | "succeeded" | "failed" | null;
  memory: {
    availableBytes: number;
    totalBytes: number;
    usedPercent: number;
  } | null;
  runtimes: Array<{
    cpuPercent: number | null;
    healthStatus: RuntimeHealthState;
    id: string;
    kind: "app" | "image" | "postgres" | "redis";
    memoryLimitBytes: number | null;
    memoryUsageBytes: number | null;
    name: string;
    observedState: RuntimeObservedState;
    restartCount: number | null;
    startedAt: string | null;
  }>;
  sourceId: string;
  status: SystemHealthStatus;
  uptimeSeconds: number | null;
};
