import { signedApiRequest } from "../infrastructure/towbar-api.js";
export async function maintainAnalyticsActivity() {
  await signedApiRequest("POST", "/v1/internal/maintenance/analytics", {});
}
