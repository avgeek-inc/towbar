import { signedApiRequest } from "../infrastructure/towbar-api.js";

const sourceSyncRequestTimeoutMs = 120_000;

type SourceSyncRequest = (
  method: "POST",
  path: string,
  body: undefined,
  options: { timeoutMs: number },
) => Promise<unknown>;

export async function executeSourceSyncActivity(
  syncId: string,
  request: SourceSyncRequest = signedApiRequest,
) {
  await request(
    "POST",
    `/v1/internal/source-syncs/${syncId}/execute`,
    undefined,
    { timeoutMs: sourceSyncRequestTimeoutMs },
  );
  await request(
    "POST",
    `/v1/internal/source-syncs/${syncId}/auto-deploy`,
    undefined,
    { timeoutMs: sourceSyncRequestTimeoutMs },
  );
}
