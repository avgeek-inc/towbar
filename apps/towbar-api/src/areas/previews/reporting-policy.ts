import { HttpError } from "../../http/errors.js";

export const previewReportingRecoveryDelayMs = 10 * 60_000;

export function previewReportingRetryAt(
  error: unknown,
  attempts: number,
  now = new Date(),
) {
  const backoff = Math.min(
    5 * 60_000 * 2 ** Math.min(Math.max(attempts - 1, 0), 4),
    60 * 60_000,
  );
  const denied =
    error instanceof HttpError && [401, 403, 404, 422].includes(error.status);
  const retryAfter =
    error instanceof HttpError
      ? Number(error.responseHeaders?.["retry-after"] ?? 0)
      : 0;
  return new Date(
    now.getTime() +
      Math.max(
        denied ? 60 * 60_000 : backoff,
        Number.isFinite(retryAfter) ? retryAfter * 1_000 : 0,
      ),
  );
}

export function previewReportDeliveryIsDue(
  input: {
    status: "pending" | "published" | "failed";
    nextAttemptAt: Date | null;
    updatedAt: Date;
  },
  now = new Date(),
) {
  if (input.status === "published") return false;
  if (input.nextAttemptAt) return input.nextAttemptAt <= now;
  return (
    input.status === "failed" ||
    input.updatedAt.getTime() + previewReportingRecoveryDelayMs <= now.getTime()
  );
}
