import type {
  RuntimeHealthState,
  RuntimeObservedState,
} from "./resource-operations.js";

export type SystemHealthStatus =
  "healthy" | "attention" | "critical" | "unknown";

export type SystemHealthCheck = {
  checkedAt: string | null;
  description: string;
  id: "api-database" | "aws" | "github" | "temporal" | "worker";
  remediationHref: string | null;
  remediationLabel: string | null;
  status: SystemHealthStatus;
  title: string;
};

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

export type SystemHealth = {
  checkedAt: string;
  checks: SystemHealthCheck[];
  runtimeCapacity: RuntimeCapacity[];
  status: SystemHealthStatus;
  version: string;
};
