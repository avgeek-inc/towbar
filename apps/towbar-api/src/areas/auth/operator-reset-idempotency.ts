import { createHmac, timingSafeEqual } from "node:crypto";

const markerPrefix = "towbar:operator-reset-idempotency:v1";
const markerPattern = /^[a-f\d]{64}$/u;

/**
 * Creates an internal idempotency marker for one operator reset value.
 *
 * This marker is not a password verifier and is never used by login. The
 * accepted password continues to be stored and verified exclusively through
 * the Argon2id password hash in `passwordCredentials.passwordHash`.
 */
export function createOperatorResetIdempotencyMarker(input: {
  email: string;
  internalHmacSecret: string;
  temporaryPassword: string;
}) {
  return createHmac("sha256", input.internalHmacSecret)
    .update(markerPrefix, "utf8")
    .update("\0", "utf8")
    .update(input.email, "utf8")
    .update("\0", "utf8")
    .update(input.temporaryPassword, "utf8")
    .digest("hex");
}

export function matchesOperatorResetIdempotencyMarker(
  candidate: string,
  stored: string | null,
) {
  if (
    !stored ||
    !markerPattern.test(candidate) ||
    !markerPattern.test(stored)
  ) {
    return false;
  }
  return timingSafeEqual(
    Buffer.from(candidate, "hex"),
    Buffer.from(stored, "hex"),
  );
}
