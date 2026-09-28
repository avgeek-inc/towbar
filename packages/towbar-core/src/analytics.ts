import { z } from "zod";

export const analyticsConfigSchema = z
  .object({
    enabled: z.literal(true),
    pageviews: z.boolean().default(false),
    visitorIdentity: z.boolean().default(false),
    retentionDays: z
      .union([z.literal(7), z.literal(30), z.literal(90)])
      .default(30),
    excludePaths: z
      .array(z.string().startsWith("/").max(256))
      .max(30)
      .default([]),
  })
  .strict()
  .refine((value) => !value.visitorIdentity || value.pageviews, {
    message: "Visitor identity requires pageviews",
    path: ["visitorIdentity"],
  });
export type AnalyticsConfig = z.infer<typeof analyticsConfigSchema>;
export const analyticsLatencyBounds = [
  10, 50, 100, 200, 500, 1000, 2500,
] as const;
export const analyticsCellSchema = z
  .object({
    appId: z.string().uuid(),
    kind: z.enum(["request", "pageview"]),
    path: z
      .string()
      .startsWith("/")
      .max(256)
      .refine((s) => !/[?#\r\n]/u.test(s)),
    referrer: z
      .string()
      .max(253)
      .regex(/^[a-z0-9.:[\]-]*$/u),
    method: z.enum([
      "GET",
      "HEAD",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "OPTIONS",
      "OTHER",
    ]),
    status: z.number().int().min(0).max(599),
    country: z.string().regex(/^(?:[A-Z]{2})?$/u),
    city: z
      .string()
      .max(128)
      .regex(/^[^\p{Cc}\p{Cf}]*$/u)
      .optional(),
    region: z
      .string()
      .max(96)
      .regex(/^[^\p{Cc}\p{Cf}]*$/u)
      .optional(),
    browser: z.enum(["", "Chrome", "Firefox", "Safari", "Edge", "Other"]),
    device: z.enum(["", "Desktop", "Mobile", "Tablet", "Bot", "Other"]),
    visitor: z.string().regex(/^(?:[a-f0-9]{64})?$/u),
    session: z.string().regex(/^(?:[a-f0-9]{64})?$/u),
    count: z.number().int().positive().max(10_000_000),
    bytes: z.number().int().nonnegative().max(1e15),
    durationMs: z.number().nonnegative().max(1e15),
    histogram: z
      .array(z.number().int().nonnegative().max(10_000_000))
      .length(8),
  })
  .strict()
  .superRefine((cell, ctx) => {
    if (
      cell.kind === "request" &&
      cell.histogram.reduce((a, b) => a + b, 0) !== cell.count
    )
      ctx.addIssue({
        code: "custom",
        message: "Latency histogram must account for every request",
      });
    if (
      cell.kind === "request" &&
      (cell.visitor ||
        cell.session ||
        cell.country ||
        cell.city ||
        cell.region ||
        cell.browser ||
        cell.device)
    )
      ctx.addIssue({
        code: "custom",
        message: "Request records cannot contain browser identity or location",
      });
    if ((cell.city && !cell.country) || (cell.region && !cell.city))
      ctx.addIssue({
        code: "custom",
        message: "City location requires a country; region requires a city",
      });
    if (
      cell.kind === "pageview" &&
      (cell.status !== 0 ||
        cell.bytes ||
        cell.durationMs ||
        cell.histogram.some(Boolean))
    )
      ctx.addIssue({
        code: "custom",
        message: "Pageviews do not measure HTTP responses",
      });
  });
export type AnalyticsCell = z.infer<typeof analyticsCellSchema>;
export const analyticsFilterSchema = z
  .object({
    field: z.enum(["path", "referrer", "country", "city", "browser"]),
    operator: z.enum(["equals", "startsWith", "in"]),
    value: z.union([
      z.string().max(256),
      z.array(z.string().max(253)).min(1).max(20),
    ]),
  })
  .strict()
  .superRefine((filter, ctx) => {
    if (filter.field === "path") {
      if (
        filter.operator === "in" ||
        typeof filter.value !== "string" ||
        !/^\/[^?#\r\n]*$/u.test(filter.value)
      )
        ctx.addIssue({
          code: "custom",
          message: "Choose a valid path and match.",
        });
      return;
    }
    const pattern =
      filter.field === "referrer"
        ? /^(?:Unknown|[a-z0-9.:[\]-]+)$/u
        : filter.field === "country"
          ? /^(?:Unknown|[A-Z]{2})$/u
          : filter.field === "city"
            ? /^[^\p{Cc}\p{Cf}]+$/u
            : /^(?:Unknown|Chrome|Firefox|Safari|Edge|Other)$/u;
    if (
      filter.operator !== "in" ||
      !Array.isArray(filter.value) ||
      filter.value.some((value) => !pattern.test(value)) ||
      new Set(filter.value).size !== filter.value.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Choose valid, distinct values.",
      });
  });
export type AnalyticsFilter = z.infer<typeof analyticsFilterSchema>;
export const analyticsFiltersSchema = z.array(analyticsFilterSchema).max(8);
export const analyticsFilterOptionsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(7),
  kind: z.enum(["request", "pageview"]).default("request"),
  field: z.enum(["referrer", "country", "city", "browser"]),
  search: z.string().max(100).default(""),
});
const encodedAnalyticsFiltersSchema = z
  .string()
  .max(8192)
  .describe(
    "JSON array of up to 8 AND conditions. Path supports equals or startsWith with a string value; referrer, country, city, and browser support in with an array of up to 20 values.",
  )
  .default("[]")
  .transform((value, ctx) => {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      ctx.addIssue({ code: "custom", message: "Filters must be a JSON array" });
      return z.NEVER;
    }
  })
  .pipe(analyticsFiltersSchema);
export const analyticsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(7),
  kind: z.enum(["request", "pageview"]).default("request"),
  filters: encodedAnalyticsFiltersSchema,
});
export type AnalyticsReport = {
  filters: AnalyticsFilter[];
  enabled: boolean;
  config: AnalyticsConfig | null;
  agentStatus: string;
  lastReceivedAt: string | null;
  droppedSamples: number;
  droppedEvents: number;
  geolocationBuiltAt: string | null;
  collectionReady: boolean;
  collectionErrors: number;
  start: string;
  end: string;
  kind: "request" | "pageview";
  total: number;
  bytes: number;
  errors: number;
  meanMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  visitors: number | null;
  sessions: number | null;
  histogram: number[];
  trend: { at: string; count: number; errors: number }[];
  deployments: { id: string; at: string; state: string; type: "deployment" }[];
  comparison: {
    start: string;
    end: string;
    total: number;
    errors: number;
    meanMs: number | null;
    visitors: number | null;
    sessions: number | null;
    trend: { at: string; count: number; errors: number }[];
  } | null;
  dimensions: Record<string, { value: string; count: number }[]>;
};
