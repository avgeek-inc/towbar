import { z } from "zod";

export const resourceOperationTypes = [
  "backup",
  "capture_logs",
  "cleanup_orphans",
  "restart",
  "start",
  "stop",
] as const;

export const resourceOperationTypeSchema = z.enum(resourceOperationTypes);
export type ResourceOperationType = z.infer<typeof resourceOperationTypeSchema>;

export const resourceOperationStates = [
  "queued",
  "running",
  "succeeded",
  "failed",
] as const;

export type ResourceOperationState = (typeof resourceOperationStates)[number];

export const runtimeDesiredStates = ["running", "stopped"] as const;
export type RuntimeDesiredState = (typeof runtimeDesiredStates)[number];

export const runtimeObservedStates = [
  "missing",
  "running",
  "stopped",
  "unknown",
] as const;
export type RuntimeObservedState = (typeof runtimeObservedStates)[number];

export const runtimeHealthStates = [
  "healthy",
  "none",
  "starting",
  "unhealthy",
  "unknown",
] as const;
export type RuntimeHealthState = (typeof runtimeHealthStates)[number];

export const runtimeDriftStates = ["drifted", "in_sync", "unknown"] as const;
export type RuntimeDriftState = (typeof runtimeDriftStates)[number];

export const orphanKinds = ["container", "image", "volume"] as const;
export const orphanKindSchema = z.enum(orphanKinds);
export type OrphanKind = z.infer<typeof orphanKindSchema>;

export const orphanItemSchema = z
  .object({
    kind: orphanKindSchema,
    name: z.string().trim().min(1).max(512),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export type OrphanItem = z.infer<typeof orphanItemSchema>;

export type RuntimeInspection = {
  cpuPercent: number | null;
  deployableId: string;
  driftReasons: string[];
  driftStatus: RuntimeDriftState;
  healthStatus: RuntimeHealthState;
  memoryLimitBytes: number | null;
  memoryUsageBytes: number | null;
  observedContainerName: string | null;
  observedImage: string | null;
  observedState: RuntimeObservedState;
  restartCount: number | null;
  startedAt: string | null;
};

export type ResourceReleaseSnapshot = {
  containerName: string;
  imageTag: string;
  releaseId: string;
};

export type ResourceOperationRequest =
  | { release: ResourceReleaseSnapshot; type: "backup" }
  | { release: ResourceReleaseSnapshot; tail: number; type: "capture_logs" }
  | { items: OrphanItem[]; type: "cleanup_orphans" }
  | { release: ResourceReleaseSnapshot; type: "restart" | "start" | "stop" };

export type PersistedResourceOperationRequest =
  | ResourceOperationRequest
  | {
      backupId: string;
      release: ResourceReleaseSnapshot;
      type: "restore";
    };

export type BackupOperationResult = {
  backupId: string;
  bucket: string;
  checksum: string;
  deletedBackupIds: string[];
  encryption: "AES256" | "aws:kms";
  key: string;
  region: string;
  sizeBytes: number;
  verifiedAt: string;
  warnings: string[];
};

export const maximumBackupBytes = 20 * 1_024 * 1_024 * 1_024;

export const backupOperationResultSchema = z
  .object({
    backupId: z.string().uuid(),
    bucket: z.string().trim().min(1).max(255),
    checksum: z.string().regex(/^[a-f0-9]{64}$/u),
    deletedBackupIds: z.array(z.string().uuid()),
    encryption: z.enum(["AES256", "aws:kms"]),
    key: z.string().trim().min(1).max(2_048),
    region: z.string().trim().min(1).max(64),
    sizeBytes: z.number().int().nonnegative().max(maximumBackupBytes),
    verifiedAt: z.string().datetime(),
    warnings: z.array(z.string().max(500)),
  })
  .strict();

export const resourceOperationResultSchema = z.union([
  backupOperationResultSchema,
  z
    .object({
      cleaned: z.array(orphanItemSchema),
      skipped: z.array(orphanItemSchema),
    })
    .strict(),
  z
    .object({
      logs: z.string().max(256 * 1_024),
      truncated: z.boolean(),
    })
    .strict(),
  z
    .object({
      restoredBackupId: z.string().uuid(),
      verifiedAt: z.string().datetime(),
    })
    .strict(),
  z.object({ state: z.enum(runtimeDesiredStates) }).strict(),
]);

export type ResourceOperationResult =
  | BackupOperationResult
  | { cleaned: OrphanItem[]; skipped: OrphanItem[] }
  | { logs: string; truncated: boolean }
  | { restoredBackupId: string; verifiedAt: string }
  | { state: RuntimeDesiredState };
