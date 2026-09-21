import { signedApiRequest } from "../infrastructure/towbar-api.js";
export async function deliverTransactionalEmailActivity(input: {
  outboxId: string;
}) {
  return signedApiRequest<
    { outcome: "done" } | { outcome: "wait"; retryAfterMs: number }
  >(
    "POST",
    `/v1/internal/transactional-emails/${input.outboxId}/deliver`,
    {},
    { maximumAttempts: 1, timeoutMs: 50_000 },
  );
}
