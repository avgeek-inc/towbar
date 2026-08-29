import { z } from "zod";

export function parseRuntimeInspections(value: unknown) {
  return z
    .array(
      z
        .object({
          cpuPercent: z.number().nonnegative().nullable(),
          deployableId: z.string().uuid(),
          driftReasons: z.array(z.string().max(500)).max(20),
          driftStatus: z.enum(["drifted", "in_sync", "unknown"]),
          healthStatus: z.enum([
            "healthy",
            "none",
            "starting",
            "unhealthy",
            "unknown",
          ]),
          memoryLimitBytes: z.number().int().nonnegative().nullable(),
          memoryUsageBytes: z.number().int().nonnegative().nullable(),
          observedContainerName: z.string().max(255).nullable(),
          observedImage: z.string().max(512).nullable(),
          observedState: z.enum(["missing", "running", "stopped", "unknown"]),
          restartCount: z.number().int().nonnegative().nullable(),
          startedAt: z.string().datetime().nullable(),
        })
        .strict(),
    )
    .parse(value);
}
