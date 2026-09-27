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
  10, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 60000,
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
    browser: z.enum(["", "Chrome", "Firefox", "Safari", "Edge", "Other"]),
    device: z.enum(["", "Desktop", "Mobile", "Tablet", "Bot", "Other"]),
    visitor: z.string().regex(/^(?:[a-f0-9]{64})?$/u),
    session: z.string().regex(/^(?:[a-f0-9]{64})?$/u),
    count: z.number().int().positive().max(10_000_000),
    bytes: z.number().int().nonnegative().max(1e15),
    durationMs: z.number().nonnegative().max(1e15),
    histogram: z
      .array(z.number().int().nonnegative().max(10_000_000))
      .length(11),
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
        cell.browser ||
        cell.device)
    )
      ctx.addIssue({
        code: "custom",
        message: "Request records cannot contain browser identity or location",
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
export const analyticsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(7),
  kind: z.enum(["request", "pageview"]).default("request"),
});
export type AnalyticsReport = {
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
  dimensions: Record<string, { value: string; count: number }[]>;
};
