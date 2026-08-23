import { z } from "zod";

const envSchema = z.object({
  SOURCE_COMMIT: z.string().min(7).default("development"),
  TEMPORAL_ADDRESS: z.string().min(1).default("127.0.0.1:7233"),
  TEMPORAL_API_KEY: z.string().min(1).optional(),
  TEMPORAL_NAMESPACE: z.string().min(1).default("default"),
  TOWBAR_APP_ID: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(1).optional(),
  ),
  TOWBAR_API_BASE_URL: z.string().url().default("http://127.0.0.1:4020"),
  TOWBAR_INTERNAL_HMAC_SECRET: z.string().min(32),
  WORKER_HEALTH_PORT: z.coerce.number().int().min(1).max(65_535).default(4_030),
});

export type TowbarWorkerEnv = z.infer<typeof envSchema>;

let cached: TowbarWorkerEnv | undefined;

export function getEnv() {
  cached ??= envSchema.parse(process.env);
  return cached;
}
