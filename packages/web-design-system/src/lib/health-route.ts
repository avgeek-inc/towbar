export function createHealthResponse(service = "towbar") {
  return Response.json(
    { service, status: "ok" },
    { headers: { "cache-control": "no-store" } },
  );
}
