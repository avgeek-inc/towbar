import { Cron } from "croner";
import { z } from "zod";

export const appJobSchema = z
  .object({
    name: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9-]{0,62}$/u),
    description: z.string().trim().max(500).optional(),
    command: z
      .array(
        z
          .string()
          .min(1)
          .max(4_096)
          .refine(
            (value) => !value.includes("\0"),
            "Command arguments cannot contain null bytes",
          ),
      )
      .min(1)
      .max(64),
    schedule: z
      .object({
        cron: z
          .string()
          .trim()
          .min(1)
          .max(120)
          .superRefine((value, context) => {
            try {
              if (value.split(/\s+/u).length !== 5)
                throw new Error("Use a five-part cron expression");
              new Cron(value, {
                mode: "5-part",
                timezone: "UTC",
                paused: true,
              });
            } catch {
              context.addIssue({
                code: "custom",
                message: "Use a valid five-part cron expression in UTC",
              });
            }
          }),
        timezone: z.literal("UTC").default("UTC"),
      })
      .strict(),
    timeoutSeconds: z.number().int().min(5).max(3_600).default(300),
    enabled: z.boolean().default(true),
  })
  .strict();

export type AppJob = z.output<typeof appJobSchema>;

export function latestAppJobOccurrence(job: AppJob, now: Date) {
  if (!job.enabled) return null;
  const minute = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
  const occurrence = new Cron(job.schedule.cron, {
    mode: "5-part",
    timezone: "UTC",
    paused: true,
  }).previousRuns(1, new Date(minute.getTime() + 1_000))[0];
  // Do not replay a backlog after an outage or an environment is resumed.
  return occurrence && occurrence.getTime() === minute.getTime()
    ? occurrence
    : null;
}

export const appJobResultSchema = z
  .object({
    jobName: z.string().min(1).max(63),
    exitCode: z.number().int().min(0).max(255),
    timedOut: z.boolean(),
    logs: z.string().max(256 * 1_024),
    truncated: z.boolean(),
  })
  .strict();
