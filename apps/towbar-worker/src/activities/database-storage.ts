import { signedApiRequest } from "../infrastructure/towbar-api.js";

export async function recordDatabaseStorageSampleActivity() {
  await signedApiRequest(
    "POST",
    "/v1/internal/maintenance/database-storage",
    {},
  );
}
