import * as Sentry from "@sentry/nextjs";
export type SentryRuntime = "browser" | "edge" | "server";
export function initializeSentry(runtime: SentryRuntime) {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  Sentry.init({
    dsn,
    enabled: Boolean(dsn),
    environment:
      process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    initialScope: { tags: { "towbar.runtime": runtime } },
    sendDefaultPii: false,
    tracesSampleRate: 0.1,
  });
}
export async function registerSentry() {
  if (process.env.NEXT_RUNTIME === "nodejs") initializeSentry("server");
  if (process.env.NEXT_RUNTIME === "edge") initializeSentry("edge");
}
export const captureRequestError = Sentry.captureRequestError;
