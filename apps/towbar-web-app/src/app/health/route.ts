import { createHealthResponse } from "@workspace/web-design-system/lib/health-route";

export const dynamic = "force-dynamic";

export function GET() {
  return createHealthResponse("towbar-web-app");
}
