import { digestValue } from "@workspace/towbar-core";

export function scopeDeploymentIdempotencyKey(
  operation: "deploy" | "rollback",
  input: { appId: string; idempotencyKey: string; releaseId?: string },
) {
  return digestValue(
    JSON.stringify({
      appId: input.appId,
      key: input.idempotencyKey,
      operation,
      releaseId: input.releaseId ?? null,
    }),
  );
}
