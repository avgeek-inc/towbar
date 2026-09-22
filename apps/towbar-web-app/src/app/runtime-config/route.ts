export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    {
      sentryDsn: process.env.NEXT_PUBLIC_SENTRY_DSN || undefined,
      sentryEnvironment:
        process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NODE_ENV,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
