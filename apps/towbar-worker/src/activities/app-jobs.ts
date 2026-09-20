import { signedApiRequest } from "../infrastructure/towbar-api.js";
export async function queueScheduledAppJobsActivity() {
  return await signedApiRequest<{ queued: number; skipped: number }>(
    "POST",
    "/v1/internal/maintenance/app-jobs",
    {},
  );
}
