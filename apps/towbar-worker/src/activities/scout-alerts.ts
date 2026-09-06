import { signedApiRequest } from "../infrastructure/towbar-api.js";

export async function evaluateScoutAlertsActivity() {
  return signedApiRequest<{ evaluated: number; more: boolean }>(
    "POST",
    "/v1/internal/maintenance/scout-alerts",
    {},
    { maximumAttempts: 1, timeoutMs: 55_000 },
  );
}
