import { z } from "zod";

export const cloudInstanceSchema = z.object({
  provider: z.enum(["aws", "gcp", "azure"]),
  type: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),
});
export type CloudInstance = z.infer<typeof cloudInstanceSchema>;
export type ServerHardware = {
  instance: CloudInstance | null;
  cpuCount: number | null;
  memoryBytes: number | null;
};

const hardwareResultSchema = z.object({
  host: z.object({
    instance: cloudInstanceSchema.nullish().catch(null),
    cpuLogicalCount: z.number().int().positive().nullish().catch(null),
    memoryTotalKb: z.number().positive().nullish().catch(null),
  }),
});

export function serverHardwareFromCheck(
  result: unknown,
): ServerHardware | null {
  const parsed = hardwareResultSchema.safeParse(result);
  if (!parsed.success) return null;
  const { host } = parsed.data;
  return {
    instance: host.instance ?? null,
    cpuCount: host.cpuLogicalCount ?? null,
    memoryBytes: host.memoryTotalKb ? host.memoryTotalKb * 1_024 : null,
  };
}
