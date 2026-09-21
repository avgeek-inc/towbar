import { z } from "zod";

import { parseCredentialsMasterKey } from "@workspace/towbar-core";

function optionalEnvironmentString(schema: z.ZodString) {
  return z.preprocess(
    (value) => (value === "" ? undefined : value),
    schema.optional(),
  );
}

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4_020),
  TOWBAR_INTERNAL_API_PORT: z.coerce
    .number()
    .int()
    .min(1)
    .max(65_535)
    .default(4_023),
  DATABASE_TOWBAR_URL: z.string().url(),
  TOWBAR_CREDENTIALS_KEY: z.string().superRefine((value, context) => {
    try {
      parseCredentialsMasterKey(value);
    } catch (error) {
      context.addIssue({
        code: "custom",
        message:
          error instanceof Error
            ? error.message
            : "Invalid credential encryption key",
      });
    }
  }),
  TOWBAR_INTERNAL_HMAC_SECRET: z.string().min(32),
  TOWBAR_API_BASE_URL: z.string().url().default("http://localhost:4021"),
  TOWBAR_APP_BASE_URL: z.string().url().default("http://localhost:4021"),
  TOWBAR_WEBSITE_BASE_URL: z.string().url().default("https://www.towbar.dev"),
  TOWBAR_VULNERABILITY_SCANNING_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  TOWBAR_VULNERABILITY_SCAN_MAX_AGE_HOURS: z.coerce
    .number()
    .int()
    .min(1)
    .max(720)
    .default(168),
  TOWBAR_API_RATE_LIMIT_MAX: z.coerce
    .number()
    .int()
    .min(1)
    .max(100000)
    .default(60),
  TOWBAR_API_RATE_LIMIT_WINDOW_SECONDS: z.coerce
    .number()
    .int()
    .min(1)
    .max(86400)
    .default(60),
  TOWBAR_TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(8).default(0),
  TOWBAR_PASSWORD_BREACH_CHECK: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  TOWBAR_PASSWORD_VERIFY_CONCURRENCY: z.coerce
    .number()
    .int()
    .min(1)
    .max(8)
    .default(2),
  TOWBAR_PASSWORD_VERIFY_QUEUE_LIMIT: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(16),
  TEMPORAL_ADDRESS: z.string().min(1).default("127.0.0.1:7233"),
  TEMPORAL_NAMESPACE: z.string().min(1).default("default"),
  TEMPORAL_API_KEY: optionalEnvironmentString(z.string().min(1)),
  SOURCE_COMMIT: z.string().min(7).default("development"),
  TOWBAR_COMMIT_SHA: optionalEnvironmentString(
    z.string().regex(/^[a-f0-9]{40}$/u),
  ),
});

type TowbarEnv = z.infer<typeof envSchema>;

let cachedEnv: TowbarEnv | undefined;

export function getEnv() {
  cachedEnv ??= envSchema.parse(process.env);
  return cachedEnv;
}

export function getAllowedOrigins() {
  const env = getEnv();
  return new Set([new URL(env.TOWBAR_APP_BASE_URL).origin]);
}
