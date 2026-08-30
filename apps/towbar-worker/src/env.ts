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
  TOWBAR_TRIVY_IMAGE: z
    .string()
    .regex(
      /^aquasec\/trivy:[a-zA-Z0-9._-]+@sha256:[a-f0-9]{64}$/u,
      "TOWBAR_TRIVY_IMAGE must pin both a tag and an image digest",
    )
    .default(
      "aquasec/trivy:0.74.0@sha256:62b1e65e8869bc4b4c6aa4fa2b21595256c7c2f6018a9d9ad61caf87187c1969",
    ),
  TOWBAR_WORKER_MAX_CONCURRENT_ACTIVITIES: z.coerce
    .number()
    .int()
    .min(1)
    .max(64)
    .default(4),
  WORKER_HEALTH_PORT: z.coerce.number().int().min(1).max(65_535).default(4_030),
});

type TowbarWorkerEnv = z.infer<typeof envSchema>;

let cached: TowbarWorkerEnv | undefined;

export function getEnv() {
  cached ??= parseEnv(process.env);
  return cached;
}

export function parseEnv(input: NodeJS.ProcessEnv) {
  return envSchema.parse(input);
}
