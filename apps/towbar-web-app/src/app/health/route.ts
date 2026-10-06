export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { service: "towbar-web-app", status: "ok" },
    { headers: { "cache-control": "no-store" } },
  );
}
